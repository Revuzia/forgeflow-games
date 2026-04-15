/**
 * ForgeFlow Games — Three.js Isometric ARPG Template
 *
 * Pre-built modules for things LLMs struggle with:
 * - Isometric camera rig with smooth follow
 * - Click-to-move with ground raycasting
 * - Melee combat with hit detection
 * - Procedural dungeon room generation
 * - CSS2D health bars for enemies
 * - Loot drop system
 * - XP/leveling
 * - HTML/CSS HUD overlay
 * - window.__TEST__ hooks for Playwright QA
 *
 * The pipeline fills in {{PLACEHOLDERS}} and extends via patches.
 * Template modules should NOT be rewritten — only extended.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ═══════════════════════════════════════════════════════════════
// GAME CONFIG — Pipeline fills these values
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
  title: "{{GAME_TITLE}}",
  dungeonWidth: 60,
  dungeonHeight: 60,
  tileSize: 2,
  roomMinSize: 5,
  roomMaxSize: 10,
  roomCount: 8,
  floorCount: 5,

  player: {
    speed: 6,
    attackRange: 2.5,
    attackDamage: 15,
    attackCooldown: 0.5,
    dodgeSpeed: 15,
    dodgeDuration: 0.2,
    dodgeCooldown: 1.0,
    maxHealth: 100,
    maxMana: 50,
    healthRegen: 0.5,
    manaRegen: 0.3,
  },

  camera: {
    distance: 15,
    height: 12,
    angle: Math.PI / 4, // 45 degrees
    smoothing: 0.08,
  },

  enemies: {{ENEMY_DATA}},
  loot_table: {{LOOT_TABLE}},

  colors: {
    floor: 0x2a2a3a,
    wall: 0x1a1a2e,
    wallTop: 0x252540,
    playerLight: 0xffaa44,
    torchLight: 0xff6622,
    ambient: 0x111133,
    fog: 0x050510,
  },
};

// ═══════════════════════════════════════════════════════════════
// CORE ENGINE
// ═══════════════════════════════════════════════════════════════
let scene, camera, renderer, cssRenderer;
let clock, raycaster, mouse;
let gameState = 'menu'; // menu | playing | paused | gameover
let currentFloor = 1;
let gold = 0;

// Game objects
let player = null;
let enemies = [];
let lootItems = [];
let dungeon = null;
let groundMesh = null;

// Input
const keys = {};
let mouseWorldPos = new THREE.Vector3();
let clickTarget = null;
let hoveredEnemy = null;

function initEngine() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.colors.fog);
  scene.fog = new THREE.FogExp2(CONFIG.colors.fog, 0.04);

  // Camera (isometric-style perspective)
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(CONFIG.camera.distance, CONFIG.camera.height, CONFIG.camera.distance);
  camera.lookAt(0, 0, 0);

  // WebGL Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  document.body.appendChild(renderer.domElement);

  // CSS2D Renderer (for health bars)
  cssRenderer = new CSS2DRenderer();
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
  cssRenderer.domElement.style.position = 'absolute';
  cssRenderer.domElement.style.top = '0';
  cssRenderer.domElement.style.pointerEvents = 'none';
  document.body.appendChild(cssRenderer.domElement);

  // Utilities
  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Lighting
  initLighting();

  // Input
  initInput();

  // Resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ═══════════════════════════════════════════════════════════════
// MODULE: LIGHTING — Dungeon atmosphere
// ═══════════════════════════════════════════════════════════════
function initLighting() {
  // Dim ambient (dungeon darkness)
  const ambient = new THREE.AmbientLight(CONFIG.colors.ambient, 0.3);
  scene.add(ambient);

  // Directional for subtle shadows
  const dirLight = new THREE.DirectionalLight(0x444466, 0.3);
  dirLight.position.set(10, 20, 10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.camera.left = -20;
  dirLight.shadow.camera.right = 20;
  dirLight.shadow.camera.top = 20;
  dirLight.shadow.camera.bottom = -20;
  scene.add(dirLight);
}

function createPlayerLight() {
  const light = new THREE.PointLight(CONFIG.colors.playerLight, 1.5, 12, 2);
  light.position.set(0, 3, 0);
  light.castShadow = false;
  return light;
}

function createTorchLight(x, z) {
  const light = new THREE.PointLight(CONFIG.colors.torchLight, 1.0, 8, 2);
  light.position.set(x, 2.5, z);

  // Torch mesh (simple cylinder + flame)
  const torchGroup = new THREE.Group();
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.08, 1.5, 6),
    new THREE.MeshStandardMaterial({ color: 0x553311 })
  );
  stick.position.y = 0.75;
  torchGroup.add(stick);

  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xff6622 })
  );
  flame.position.y = 1.6;
  torchGroup.add(flame);
  torchGroup.position.set(x, 0, z);
  scene.add(torchGroup);
  scene.add(light);

  return { light, group: torchGroup, baseIntensity: 1.0 };
}

// ═══════════════════════════════════════════════════════════════
// MODULE: DUNGEON GENERATION — Procedural rooms + corridors
// ═══════════════════════════════════════════════════════════════
function generateDungeon(width, height, roomCount) {
  const tiles = Array.from({ length: height }, () => Array(width).fill(1)); // 1 = wall
  const rooms = [];
  const torches = [];

  // Place rooms
  for (let i = 0; i < roomCount * 3 && rooms.length < roomCount; i++) {
    const w = CONFIG.roomMinSize + Math.floor(Math.random() * (CONFIG.roomMaxSize - CONFIG.roomMinSize));
    const h = CONFIG.roomMinSize + Math.floor(Math.random() * (CONFIG.roomMaxSize - CONFIG.roomMinSize));
    const x = 2 + Math.floor(Math.random() * (width - w - 4));
    const y = 2 + Math.floor(Math.random() * (height - h - 4));

    // Check overlap
    let overlaps = false;
    for (const room of rooms) {
      if (x < room.x + room.w + 2 && x + w + 2 > room.x &&
          y < room.y + room.h + 2 && y + h + 2 > room.y) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    // Carve room
    for (let ry = y; ry < y + h; ry++) {
      for (let rx = x; rx < x + w; rx++) {
        tiles[ry][rx] = 0; // 0 = floor
      }
    }
    rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });

    // Add torches in corners
    torches.push({ x: x + 0.5, z: y + 0.5 });
    torches.push({ x: x + w - 0.5, z: y + 0.5 });
  }

  // Connect rooms with corridors
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1];
    const b = rooms[i];
    let cx = a.cx, cy = a.cy;

    while (cx !== b.cx) {
      if (cy >= 0 && cy < height && cx >= 0 && cx < width) tiles[cy][cx] = 0;
      cx += cx < b.cx ? 1 : -1;
    }
    while (cy !== b.cy) {
      if (cy >= 0 && cy < height && cx >= 0 && cx < width) tiles[cy][cx] = 0;
      cy += cy < b.cy ? 1 : -1;
    }
  }

  return { tiles, rooms, torches, width, height };
}

function buildDungeonMesh(dungeon) {
  const { tiles, width, height } = dungeon;
  const ts = CONFIG.tileSize;

  // Floor
  const floorGeo = new THREE.PlaneGeometry(width * ts, height * ts);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.floor,
    roughness: 0.9,
    metalness: 0.1,
  });
  groundMesh = new THREE.Mesh(floorGeo, floorMat);
  groundMesh.position.set(width * ts / 2, 0, height * ts / 2);
  groundMesh.receiveShadow = true;
  groundMesh.name = 'ground';
  scene.add(groundMesh);

  // Walls
  const wallMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.wall,
    roughness: 0.8,
  });
  const wallTopMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.wallTop,
    roughness: 0.7,
  });

  const wallGeo = new THREE.BoxGeometry(ts, 3, ts);
  const wallInstances = new THREE.InstancedMesh(wallGeo, wallMat, width * height);
  let wallCount = 0;
  const matrix = new THREE.Matrix4();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] === 1) {
        // Check if adjacent to floor (visible wall)
        const hasFloorNeighbor = (
          (x > 0 && tiles[y][x-1] === 0) ||
          (x < width-1 && tiles[y][x+1] === 0) ||
          (y > 0 && tiles[y-1][x] === 0) ||
          (y < height-1 && tiles[y+1][x] === 0)
        );
        if (hasFloorNeighbor) {
          matrix.setPosition(x * ts + ts/2, 1.5, y * ts + ts/2);
          wallInstances.setMatrixAt(wallCount++, matrix);
        }
      }
    }
  }
  wallInstances.count = wallCount;
  wallInstances.instanceMatrix.needsUpdate = true;
  wallInstances.castShadow = true;
  wallInstances.receiveShadow = true;
  scene.add(wallInstances);

  // Torches
  const torchObjects = [];
  for (const t of dungeon.torches) {
    torchObjects.push(createTorchLight(t.x * ts, t.z * ts));
  }

  return { wallInstances, torchObjects };
}

// ═══════════════════════════════════════════════════════════════
// MODULE: PLAYER — Character controller
// ═══════════════════════════════════════════════════════════════
function createPlayer(spawnX, spawnZ) {
  const ts = CONFIG.tileSize;
  const group = new THREE.Group();

  // Body (capsule shape)
  const bodyGeo = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4488ff, roughness: 0.5 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.7;
  body.castShadow = true;
  group.add(body);

  // Head
  const headGeo = new THREE.SphereGeometry(0.25, 8, 8);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffcc88, roughness: 0.6 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.4;
  head.castShadow = true;
  group.add(head);

  // Weapon (sword)
  const swordGeo = new THREE.BoxGeometry(0.08, 0.8, 0.04);
  const swordMat = new THREE.MeshStandardMaterial({ color: 0xccccdd, metalness: 0.8, roughness: 0.2 });
  const sword = new THREE.Mesh(swordGeo, swordMat);
  sword.position.set(0.5, 0.8, 0);
  sword.rotation.z = -0.3;
  group.add(sword);

  // Player light
  const light = createPlayerLight();
  group.add(light);

  group.position.set(spawnX * ts + ts/2, 0, spawnZ * ts + ts/2);
  scene.add(group);

  player = {
    mesh: group,
    body, head, sword,
    health: CONFIG.player.maxHealth,
    maxHealth: CONFIG.player.maxHealth,
    mana: CONFIG.player.maxMana,
    maxMana: CONFIG.player.maxMana,
    level: 1,
    xp: 0,
    xpToNext: 100,
    attack: CONFIG.player.attackDamage,
    defense: 5,
    speed: CONFIG.player.speed,
    alive: true,
    attackCooldown: 0,
    dodgeCooldown: 0,
    isDodging: false,
    dodgeTimer: 0,
    dodgeDir: new THREE.Vector3(),
    moveTarget: null,
    inventory: [],
    equipment: { weapon: null, armor: null, ring: null },
  };
}

function updatePlayer(dt) {
  if (!player || !player.alive) return;

  const p = player;
  const pos = p.mesh.position;
  const moveDir = new THREE.Vector3();

  // Cooldowns
  if (p.attackCooldown > 0) p.attackCooldown -= dt;
  if (p.dodgeCooldown > 0) p.dodgeCooldown -= dt;

  // Dodge movement
  if (p.isDodging) {
    p.dodgeTimer -= dt;
    pos.addScaledVector(p.dodgeDir, CONFIG.player.dodgeSpeed * dt);
    if (p.dodgeTimer <= 0) p.isDodging = false;
    return;
  }

  // WASD movement
  if (keys['KeyW'] || keys['ArrowUp']) moveDir.z -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) moveDir.z += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) moveDir.x -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) moveDir.x += 1;

  // Click-to-move
  if (clickTarget && moveDir.length() === 0) {
    const diff = clickTarget.clone().sub(pos);
    diff.y = 0;
    if (diff.length() > 0.5) {
      moveDir.copy(diff.normalize());
    } else {
      clickTarget = null;
    }
  }

  if (moveDir.length() > 0) {
    moveDir.normalize();
    const newPos = pos.clone().addScaledVector(moveDir, p.speed * dt);

    // Wall collision check
    const tileX = Math.floor(newPos.x / CONFIG.tileSize);
    const tileZ = Math.floor(newPos.z / CONFIG.tileSize);
    if (dungeon && tileX >= 0 && tileX < dungeon.width && tileZ >= 0 && tileZ < dungeon.height) {
      if (dungeon.tiles[tileZ][tileX] === 0) {
        pos.copy(newPos);
      }
    }

    // Face movement direction
    p.mesh.rotation.y = Math.atan2(moveDir.x, moveDir.z);

    // Bob animation
    p.body.position.y = 0.7 + Math.sin(clock.elapsedTime * 8) * 0.05;
  }

  // Regen
  p.health = Math.min(p.maxHealth, p.health + CONFIG.player.healthRegen * dt);
  p.mana = Math.min(p.maxMana, p.mana + CONFIG.player.manaRegen * dt);

  // Attack
  if ((keys['KeyX'] || keys['Space']) && p.attackCooldown <= 0) {
    performAttack();
  }

  updateHUD();
}

function performAttack() {
  if (!player || player.attackCooldown > 0) return;
  player.attackCooldown = CONFIG.player.attackCooldown;

  // Swing animation
  const sword = player.sword;
  sword.rotation.z = -1.5;
  setTimeout(() => { if (sword) sword.rotation.z = -0.3; }, 200);

  // Hit detection — check all enemies in range
  const playerPos = player.mesh.position;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.mesh.quaternion);

  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const dist = playerPos.distanceTo(enemy.mesh.position);
    if (dist < CONFIG.player.attackRange) {
      const toEnemy = enemy.mesh.position.clone().sub(playerPos).normalize();
      const dot = forward.dot(toEnemy);
      if (dot > -0.3) { // Wide arc attack
        damageEnemy(enemy, player.attack);
      }
    }
  }

  // SFX
  playSound('attack_swing');

  // Screen shake
  shakeCamera(0.1, 2);
}

// ═══════════════════════════════════════════════════════════════
// MODULE: ENEMIES — AI with state machine
// ═══════════════════════════════════════════════════════════════
function spawnEnemy(type, x, z) {
  const ts = CONFIG.tileSize;
  const group = new THREE.Group();

  // Enemy body (color-coded by type)
  const colors = { melee: 0xcc3333, ranged: 0x8833cc, tank: 0x336633, boss: 0xcc6600 };
  const sizes = { melee: 0.35, ranged: 0.3, tank: 0.5, boss: 0.7 };

  const bodyGeo = new THREE.CapsuleGeometry(sizes[type] || 0.35, 0.6, 4, 8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: colors[type] || 0xcc3333, roughness: 0.5 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.6;
  body.castShadow = true;
  group.add(body);

  // Eyes
  const eyeGeo = new THREE.SphereGeometry(0.08, 6, 6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.12, 1.0, -0.2);
  group.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.12;
  group.add(eyeR);

  // Health bar (CSS2D)
  const hpBarContainer = document.createElement('div');
  hpBarContainer.style.cssText = 'width:40px;height:4px;background:rgba(0,0,0,0.7);border-radius:2px;overflow:hidden';
  const hpBarFill = document.createElement('div');
  hpBarFill.style.cssText = 'width:100%;height:100%;background:#cc3333;border-radius:2px;transition:width 0.2s';
  hpBarContainer.appendChild(hpBarFill);
  const hpLabel = new CSS2DObject(hpBarContainer);
  hpLabel.position.set(0, 1.8, 0);
  group.add(hpLabel);

  group.position.set(x * ts + ts/2, 0, z * ts + ts/2);
  scene.add(group);

  const maxHp = type === 'boss' ? 200 : type === 'tank' ? 80 : 40;
  const damage = type === 'boss' ? 25 : type === 'ranged' ? 12 : 15;
  const speed = type === 'tank' ? 2 : type === 'boss' ? 3 : 4;

  const enemy = {
    mesh: group, body, hpBarFill,
    type, alive: true,
    hp: maxHp, maxHp,
    damage, speed,
    state: 'idle', // idle, patrol, chase, attack, dead
    patrolTarget: null,
    attackCooldown: 0,
    startPos: new THREE.Vector3(x * ts + ts/2, 0, z * ts + ts/2),
    detectionRange: type === 'ranged' ? 12 : 8,
    attackRange: type === 'ranged' ? 8 : 2,
  };
  enemies.push(enemy);
  return enemy;
}

function updateEnemies(dt) {
  if (!player || !player.alive) return;
  const playerPos = player.mesh.position;

  for (const e of enemies) {
    if (!e.alive) continue;

    const pos = e.mesh.position;
    const dist = pos.distanceTo(playerPos);
    e.attackCooldown = Math.max(0, e.attackCooldown - dt);

    // State machine
    switch (e.state) {
      case 'idle':
        if (dist < e.detectionRange) e.state = 'chase';
        else {
          // Idle bob
          e.body.position.y = 0.6 + Math.sin(clock.elapsedTime * 2 + pos.x) * 0.03;
        }
        break;

      case 'chase':
        if (dist > e.detectionRange * 1.5) { e.state = 'idle'; break; }
        if (dist < e.attackRange) { e.state = 'attack'; break; }

        const dir = playerPos.clone().sub(pos).normalize();
        dir.y = 0;
        const newPos = pos.clone().addScaledVector(dir, e.speed * dt);

        // Simple wall check
        const tx = Math.floor(newPos.x / CONFIG.tileSize);
        const tz = Math.floor(newPos.z / CONFIG.tileSize);
        if (dungeon && tx >= 0 && tx < dungeon.width && tz >= 0 && tz < dungeon.height) {
          if (dungeon.tiles[tz][tx] === 0) {
            pos.copy(newPos);
          }
        }
        e.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        break;

      case 'attack':
        if (dist > e.attackRange * 1.3) { e.state = 'chase'; break; }
        if (e.attackCooldown <= 0) {
          // Attack player
          e.attackCooldown = 1.0;
          const dmg = Math.max(1, e.damage - player.defense);
          player.health -= dmg;
          showDamageNumber(playerPos.x, playerPos.y + 2, playerPos.z, dmg, false);
          playSound('hit_player');
          shakeCamera(0.15, 3);

          if (player.health <= 0) {
            player.alive = false;
            gameOver();
          }
        }
        // Face player
        const faceDir = playerPos.clone().sub(pos).normalize();
        e.mesh.rotation.y = Math.atan2(faceDir.x, faceDir.z);
        break;
    }
  }
}

function damageEnemy(enemy, damage) {
  enemy.hp -= damage;
  enemy.hpBarFill.style.width = Math.max(0, (enemy.hp / enemy.maxHp) * 100) + '%';

  const pos = enemy.mesh.position;
  const isCrit = Math.random() < 0.15;
  const finalDmg = isCrit ? damage * 2 : damage;
  if (isCrit) enemy.hp -= damage; // Extra damage for crit

  showDamageNumber(pos.x, pos.y + 2, pos.z, finalDmg, isCrit);
  playSound('hit_enemy');

  // Flash red
  enemy.body.material.emissive.setHex(0xff0000);
  setTimeout(() => { if (enemy.body) enemy.body.material.emissive.setHex(0); }, 100);

  if (enemy.hp <= 0) {
    killEnemy(enemy);
  } else {
    enemy.state = 'chase'; // Aggro on hit
  }
}

function killEnemy(enemy) {
  enemy.alive = false;
  enemy.mesh.visible = false;
  playSound('enemy_die');
  shakeCamera(0.1, 2);

  // XP
  const xpGain = enemy.type === 'boss' ? 100 : 25;
  player.xp += xpGain;
  gold += Math.floor(Math.random() * 10) + 5;
  showDamageNumber(enemy.mesh.position.x, enemy.mesh.position.y + 2, enemy.mesh.position.z, `+${xpGain} XP`, false, '#ffaa00');

  // Check level up
  while (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level++;
    player.xpToNext = Math.floor(100 * Math.pow(1.4, player.level - 1));
    player.maxHealth += 15;
    player.maxMana += 8;
    player.health = player.maxHealth;
    player.mana = player.maxMana;
    player.attack += 3;
    playSound('level_up');
    showDamageNumber(player.mesh.position.x, player.mesh.position.y + 3, player.mesh.position.z, 'LEVEL UP!', false, '#00ff88');
  }

  // Loot drop
  if (Math.random() < 0.4) {
    spawnLoot(enemy.mesh.position.x, enemy.mesh.position.z, enemy.type);
  }

  // Remove from scene after delay
  setTimeout(() => { if (enemy.mesh.parent) scene.remove(enemy.mesh); }, 500);
}

// ═══════════════════════════════════════════════════════════════
// MODULE: LOOT — Item drops and pickup
// ═══════════════════════════════════════════════════════════════
function spawnLoot(x, z, enemyType) {
  const types = ['potion_health', 'potion_mana', 'weapon', 'armor', 'gold'];
  const weights = [30, 20, 15, 15, 20];
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let itemType = types[0];
  for (let i = 0; i < types.length; i++) {
    r -= weights[i];
    if (r <= 0) { itemType = types[i]; break; }
  }

  const colors = { potion_health: 0xff3333, potion_mana: 0x3333ff, weapon: 0xccccdd, armor: 0x886633, gold: 0xffcc00 };
  const geo = new THREE.SphereGeometry(0.2, 8, 8);
  const mat = new THREE.MeshStandardMaterial({
    color: colors[itemType] || 0xffffff,
    emissive: colors[itemType] || 0xffffff,
    emissiveIntensity: 0.5,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, 0.5, z);
  scene.add(mesh);

  // Glow light
  const light = new THREE.PointLight(colors[itemType], 0.5, 3);
  light.position.copy(mesh.position);
  light.position.y = 1;
  scene.add(light);

  lootItems.push({ mesh, light, type: itemType, value: Math.floor(Math.random() * 10) + 5, bobPhase: Math.random() * Math.PI * 2 });
}

function updateLoot(dt) {
  if (!player || !player.alive) return;
  const playerPos = player.mesh.position;

  for (let i = lootItems.length - 1; i >= 0; i--) {
    const item = lootItems[i];
    // Bob animation
    item.mesh.position.y = 0.5 + Math.sin(clock.elapsedTime * 3 + item.bobPhase) * 0.15;
    item.mesh.rotation.y += dt * 2;

    // Pickup check
    const dist = playerPos.distanceTo(item.mesh.position);
    if (dist < 1.5) {
      pickupItem(item);
      scene.remove(item.mesh);
      scene.remove(item.light);
      lootItems.splice(i, 1);
    }
  }
}

function pickupItem(item) {
  playSound('pickup_item');
  switch (item.type) {
    case 'potion_health':
      player.health = Math.min(player.maxHealth, player.health + 30);
      showDamageNumber(player.mesh.position.x, player.mesh.position.y + 2, player.mesh.position.z, '+30 HP', false, '#00ff88');
      break;
    case 'potion_mana':
      player.mana = Math.min(player.maxMana, player.mana + 20);
      showDamageNumber(player.mesh.position.x, player.mesh.position.y + 2, player.mesh.position.z, '+20 MP', false, '#3388ff');
      break;
    case 'gold':
      gold += item.value;
      showDamageNumber(player.mesh.position.x, player.mesh.position.y + 2, player.mesh.position.z, `+${item.value} Gold`, false, '#ffcc00');
      break;
    case 'weapon':
      player.attack += 2;
      showDamageNumber(player.mesh.position.x, player.mesh.position.y + 2, player.mesh.position.z, '+2 ATK', false, '#ccccdd');
      break;
    case 'armor':
      player.defense += 1;
      showDamageNumber(player.mesh.position.x, player.mesh.position.y + 2, player.mesh.position.z, '+1 DEF', false, '#886633');
      break;
  }
}

// ═══════════════════════════════════════════════════════════════
// MODULE: CAMERA — Isometric follow
// ═══════════════════════════════════════════════════════════════
function updateCamera() {
  if (!player) return;
  const target = player.mesh.position;
  const offset = new THREE.Vector3(
    Math.sin(CONFIG.camera.angle) * CONFIG.camera.distance,
    CONFIG.camera.height,
    Math.cos(CONFIG.camera.angle) * CONFIG.camera.distance
  );
  const desired = target.clone().add(offset);

  camera.position.lerp(desired, CONFIG.camera.smoothing);
  camera.lookAt(target.x, target.y + 1, target.z);
}

let shakeIntensity = 0, shakeDuration = 0;
function shakeCamera(duration, intensity) {
  shakeDuration = duration;
  shakeIntensity = intensity;
}
function applyShake(dt) {
  if (shakeDuration > 0) {
    shakeDuration -= dt;
    camera.position.x += (Math.random() - 0.5) * shakeIntensity * 0.1;
    camera.position.z += (Math.random() - 0.5) * shakeIntensity * 0.1;
  }
}

// ═══════════════════════════════════════════════════════════════
// MODULE: UI — HUD updates + damage numbers
// ═══════════════════════════════════════════════════════════════
function updateHUD() {
  if (!player) return;
  const p = player;
  document.getElementById('hp-text').textContent = `${Math.ceil(p.health)}/${p.maxHealth}`;
  document.getElementById('hp-bar').style.width = `${(p.health / p.maxHealth) * 100}%`;
  document.getElementById('mp-text').textContent = `${Math.ceil(p.mana)}/${p.maxMana}`;
  document.getElementById('mp-bar').style.width = `${(p.mana / p.maxMana) * 100}%`;
  document.getElementById('xp-text').textContent = `${p.xp}/${p.xpToNext}`;
  document.getElementById('xp-bar').style.width = `${(p.xp / p.xpToNext) * 100}%`;
  document.getElementById('level-text').textContent = p.level;
  document.getElementById('gold-text').textContent = gold;
  document.getElementById('floor-text').textContent = currentFloor;
}

function showDamageNumber(x, y, z, text, isCrit, color) {
  const div = document.createElement('div');
  div.className = `damage-number${isCrit ? ' crit' : ''}`;
  if (color) div.style.color = color;
  div.textContent = text;

  // Project 3D position to screen
  const pos = new THREE.Vector3(x, y, z);
  pos.project(camera);
  const sx = (pos.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-pos.y * 0.5 + 0.5) * window.innerHeight;
  div.style.left = sx + 'px';
  div.style.top = sy + 'px';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 1000);
}

// ═══════════════════════════════════════════════════════════════
// MODULE: INPUT
// ═══════════════════════════════════════════════════════════════
function initInput() {
  window.addEventListener('keydown', e => { keys[e.code] = true; });
  window.addEventListener('keyup', e => { keys[e.code] = false; });

  renderer.domElement.addEventListener('click', e => {
    if (gameState !== 'playing') return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Check enemy click (attack)
    const enemyMeshes = enemies.filter(e => e.alive).map(e => e.mesh);
    // Raycast children recursively
    const allMeshes = [];
    for (const em of enemyMeshes) {
      em.traverse(child => { if (child.isMesh) allMeshes.push(child); });
    }
    const enemyHits = raycaster.intersectObjects(allMeshes, false);
    if (enemyHits.length > 0) {
      // Find which enemy was clicked
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        let found = false;
        enemy.mesh.traverse(child => {
          if (enemyHits.some(h => h.object === child)) found = true;
        });
        if (found) {
          if (player.mesh.position.distanceTo(enemy.mesh.position) < CONFIG.player.attackRange) {
            performAttack();
          } else {
            clickTarget = enemy.mesh.position.clone();
          }
          return;
        }
      }
    }

    // Click ground to move
    if (groundMesh) {
      const groundHits = raycaster.intersectObject(groundMesh);
      if (groundHits.length > 0) {
        clickTarget = groundHits[0].point.clone();
        clickTarget.y = 0;
      }
    }
  });

  // Dodge on space
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && player && player.dodgeCooldown <= 0 && !player.isDodging) {
      player.isDodging = true;
      player.dodgeTimer = CONFIG.player.dodgeDuration;
      player.dodgeCooldown = CONFIG.player.dodgeCooldown;
      const dir = new THREE.Vector3();
      if (keys['KeyW']) dir.z -= 1;
      if (keys['KeyS']) dir.z += 1;
      if (keys['KeyA']) dir.x -= 1;
      if (keys['KeyD']) dir.x += 1;
      if (dir.length() === 0) dir.z = -1; // Default dodge forward
      player.dodgeDir.copy(dir.normalize());
    }
  });

  // Inventory toggle
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyI') {
      const panel = document.getElementById('inventory-panel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// MODULE: AUDIO
// ═══════════════════════════════════════════════════════════════
const audioCache = {};
function playSound(name) {
  try {
    if (!audioCache[name]) {
      audioCache[name] = new Audio(`assets/audio/sfx_${name}.ogg`);
      audioCache[name].volume = 0.5;
    }
    const snd = audioCache[name].cloneNode();
    snd.volume = 0.5;
    snd.play().catch(() => {});
  } catch (e) {}
}

function playMusic(name) {
  try {
    const music = new Audio(`assets/audio/${name}.ogg`);
    music.volume = 0.2;
    music.loop = true;
    music.play().catch(() => {});
    return music;
  } catch (e) { return null; }
}

// ═══════════════════════════════════════════════════════════════
// MODULE: GAME FLOW
// ═══════════════════════════════════════════════════════════════
function startGame() {
  document.getElementById('menu-screen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  gameState = 'playing';

  // Generate dungeon
  dungeon = generateDungeon(CONFIG.dungeonWidth, CONFIG.dungeonHeight, CONFIG.roomCount);
  buildDungeonMesh(dungeon);

  // Spawn player in first room
  const startRoom = dungeon.rooms[0];
  createPlayer(startRoom.cx, startRoom.cy);

  // Spawn enemies in other rooms
  for (let i = 1; i < dungeon.rooms.length; i++) {
    const room = dungeon.rooms[i];
    const count = 2 + Math.floor(Math.random() * 3);
    for (let j = 0; j < count; j++) {
      const ex = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
      const ez = room.y + 1 + Math.floor(Math.random() * (room.h - 2));
      const type = i === dungeon.rooms.length - 1 && j === 0 ? 'boss' : ['melee', 'melee', 'ranged', 'tank'][Math.floor(Math.random() * 4)];
      spawnEnemy(type, ex, ez);
    }
  }

  // Start music
  playMusic('music_level');

  // Expose test hooks
  exposeTestAPI();
}

function gameOver() {
  gameState = 'gameover';
  document.getElementById('gameover-screen').style.display = 'flex';
  document.getElementById('go-floor').textContent = currentFloor;
  document.getElementById('go-gold').textContent = gold;
}

function exposeTestAPI() {
  window.__TEST__ = {
    getPlayer: () => player ? {
      x: player.mesh.position.x, y: player.mesh.position.y, z: player.mesh.position.z,
      health: player.health, mana: player.mana, level: player.level, xp: player.xp,
      alive: player.alive, attack: player.attack, defense: player.defense,
    } : null,
    getScore: () => gold,
    getLives: () => player ? player.health : 0,
    getEnemies: () => enemies.filter(e => e.alive).map(e => ({
      x: e.mesh.position.x, y: e.mesh.position.y, z: e.mesh.position.z,
      type: e.type, hp: e.hp, alive: e.alive,
    })),
    getCurrentScene: () => gameState,
    getLevel: () => currentFloor,
    getInventory: () => player ? player.inventory : [],
  };
  window.__GAME__ = { scene, camera, renderer };
}

// ═══════════════════════════════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════════════════════════════
function gameLoop() {
  requestAnimationFrame(gameLoop);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (gameState === 'playing') {
    updatePlayer(dt);
    updateEnemies(dt);
    updateLoot(dt);
    updateCamera();
    applyShake(dt);

    // Torch flicker
    // (handled by torch objects if they exist)
  }

  renderer.render(scene, camera);
  cssRenderer.render(scene, camera);
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
initEngine();
gameLoop();

// Menu button
document.getElementById('play-btn').addEventListener('click', startGame);

// PostMessage for ForgeFlow portal
window.addEventListener('message', e => {
  if (e.data?.type === 'forgeflow:pause') gameState = 'paused';
  if (e.data?.type === 'forgeflow:resume') gameState = 'playing';
});
