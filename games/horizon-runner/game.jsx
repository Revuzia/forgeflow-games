import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, Heart, Star, Zap, TreePine, Snowflake, Droplets, Flame, Cloud, Gem, Mountain, Palette, Moon, Sun, ArrowRight, Flag, DoorOpen, Coins, MapPin, Play } from 'lucide-react';

const GRAVITY = 0.8;
const JUMP_FORCE = -14;  // Slightly reduced for lower platforms
const RUN_SPEED = 7;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 50;
// 2026-05-08 — FIXED virtual game world (16:9). Internal canvas resolution
// is pinned at 1280x720 forever; the wrapper index.html scales the *display*
// size to fit any viewport. Was: window.innerWidth/Height (evaluated once at
// module load), which made every iframe load render at a different scale and
// the "world" appear zoomed-in or zoomed-out depending on iframe size.
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

const HorizonRunner = () => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const [gameState, setGameState] = useState('menu');
  const [theme, setTheme] = useState('');
  const [level, setLevel] = useState(1);
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [lives, setLives] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [levelData, setLevelData] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [checkpoint, setCheckpoint] = useState(null);
  const [levelProgress, setLevelProgress] = useState(0);
  const [powerUp, setPowerUp] = useState(null);
  const [powerUpTimer, setPowerUpTimer] = useState(0);
  const [waypointMessage, setWaypointMessage] = useState('');
  const [waypointMessageTimer, setWaypointMessageTimer] = useState(0);
  const [damageFlash, setDamageFlash] = useState(0);
  const [hurtMessage, setHurtMessage] = useState('');
  const [hurtMessageTimer, setHurtMessageTimer] = useState(0);
  const [isInvulnerable, setIsInvulnerable] = useState(false);
  const [progress, setProgress] = useState(() => {
    const saved = localStorage.getItem('horizonRunnerProgress');
    return saved ? JSON.parse(saved) : { 'Mystic Plains': 0 };
  });
  
  const gameRefs = useRef({
    player: {
      x: 150,
      y: CANVAS_HEIGHT - 150,  // Properly on ground
      vx: 0,
      vy: 0,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      grounded: false,
      jumping: false,
      running: false,
      facing: 'right',
      invulnerable: false,
      animFrame: 0,
      speedBoost: 1,
      hasShield: false
    },
    camera: { x: 0, y: 0 },
    particles: [],
    collectedCoins: new Set(),
    defeatedEnemies: new Set(),
    passedWaypoints: new Set(),
    brokenBoxes: new Set(),
    openedChests: new Set(),
    keys: {},
    platformStates: new Map(),
    enemyStates: new Map(),
    time: 0,
    lastFrameTime: 0,
    levelLength: 0,
    doorReached: false
  });

  const themes = [
    { name: 'Mystic Plains', icon: Sun, color: '#22c55e', bg: '#14532d' },
    { name: 'Crystal Caverns', icon: Gem, color: '#06b6d4', bg: '#083344' },
    { name: 'Cloudtop Highway', icon: Cloud, color: '#e0f2fe', bg: '#0c4a6e' },
    { name: 'Lava Bridge', icon: Flame, color: '#f97316', bg: '#431407' },
    { name: 'Frozen Tundra', icon: Snowflake, color: '#bfdbfe', bg: '#172554' },
    { name: 'Jungle Path', icon: TreePine, color: '#4ade80', bg: '#14532d' },
    { name: 'Neon City', icon: Zap, color: '#ec4899', bg: '#1e1b4b' },
    { name: 'Desert Ruins', icon: Mountain, color: '#d97706', bg: '#451a03' },
    { name: 'Moonlit Road', icon: Moon, color: '#a78bfa', bg: '#1e1b4b' },
    { name: 'Golden Palace', icon: Star, color: '#fbbf24', bg: '#78350f' }
  ];

  const createLevel = (themeName, difficulty) => {
    const levelLength = 3000 + (difficulty * 1500);
    const platforms = [];
    const enemies = [];
    const collectibles = [];
    const waypoints = [];
    const obstacles = [];
    const boxes = [];
    const chests = [];
    
    const themeColors = {
      'Mystic Plains': { color: '#22c55e', bg: '#14532d', platform: '#166534', gradient1: '#1a5c3a', gradient2: '#052e16', particle: '#86efac', enemyColor: '#dc2626' },
      'Crystal Caverns': { color: '#22d3ee', bg: '#083344', platform: '#0891b2', gradient1: '#0a1929', gradient2: '#030810', particle: '#22d3ee', enemyColor: '#f43f5e' },
      'Cloudtop Highway': { color: '#e0f2fe', bg: '#0c4a6e', platform: '#075985', gradient1: '#0c5a8e', gradient2: '#082f49', particle: '#bae6fd', enemyColor: '#ef4444' },
      'Lava Bridge': { color: '#f97316', bg: '#431407', platform: '#7c2d12', gradient1: '#5c1f07', gradient2: '#1c0a00', particle: '#fb923c', enemyColor: '#dc2626' },
      'Frozen Tundra': { color: '#bfdbfe', bg: '#172554', platform: '#1e3a8a', gradient1: '#1e3a8a', gradient2: '#0f172a', particle: '#dbeafe', enemyColor: '#7c3aed' },
      'Jungle Path': { color: '#4ade80', bg: '#14532d', platform: '#166534', gradient1: '#1a5c3a', gradient2: '#052e16', particle: '#86efac', enemyColor: '#f59e0b' },
      'Neon City': { color: '#ec4899', bg: '#1e1b4b', platform: '#312e81', gradient1: '#2e2b6b', gradient2: '#0f0a2e', particle: '#f9a8d4', enemyColor: '#06b6d4' },
      'Desert Ruins': { color: '#d97706', bg: '#451a03', platform: '#78350f', gradient1: '#5c2509', gradient2: '#1c0a00', particle: '#fbbf24', enemyColor: '#ef4444' },
      'Moonlit Road': { color: '#a78bfa', bg: '#1e1b4b', platform: '#312e81', gradient1: '#2e2b6b', gradient2: '#0f0a2e', particle: '#c4b5fd', enemyColor: '#f43f5e' },
      'Golden Palace': { color: '#fbbf24', bg: '#78350f', platform: '#92400e', gradient1: '#854d0e', gradient2: '#451a03', particle: '#fde047', enemyColor: '#dc2626' }
    };
    
    const currentTheme = themeColors[themeName] || themeColors['Mystic Plains'];
    
    // Ground platform
    platforms.push({
      x: 0,
      y: CANVAS_HEIGHT - 100,
      width: levelLength + 500,
      height: 200,
      type: 'ground',
      index: 0
    });
    
    // Generate multi-tiered platforms
    const sections = Math.floor(levelLength / 600);
    let platformIndex = 1;
    
    for (let section = 0; section < sections; section++) {
      const sectionX = section * 600 + 300;
      
      // Lower tier platforms
      if (Math.random() > 0.3) {
        platforms.push({
          x: sectionX + Math.random() * 200,
          y: CANVAS_HEIGHT - 160,
          width: 120 + Math.random() * 60,
          height: 20,
          type: 'normal',
          tier: 1,
          index: platformIndex++
        });
      }
      
      // Middle tier platforms
      if (Math.random() > 0.4) {
        platforms.push({
          x: sectionX + 100 + Math.random() * 200,
          y: CANVAS_HEIGHT - 220,
          width: 100 + Math.random() * 80,
          height: 20,
          type: Math.random() > 0.7 ? 'moving' : 'normal',
          tier: 2,
          moveSpeed: 1,
          moveRange: 40,
          moveDirection: 'horizontal',
          index: platformIndex++
        });
      }
      
      // Upper tier platforms (only in later levels)
      if (Math.random() > 0.6 && difficulty > 2) {
        platforms.push({
          x: sectionX + 50 + Math.random() * 200,
          y: CANVAS_HEIGHT - 280,
          width: 80 + Math.random() * 60,
          height: 20,
          type: Math.random() > 0.8 ? 'bouncy' : 'normal',
          tier: 3,
          index: platformIndex++
        });
      }
    }
    
    // Generate enemies with variety based on difficulty level
    const enemyTypes = ['bouncingBall', 'rollingBall', 'bouncingSquare', 'flyingDrone'];
    const enemyCount = 6 + difficulty * 2; 
    const usablePlatforms = platforms.filter(p => p.type !== 'ground' && p.type !== 'bouncy');
    
    for (let i = 0; i < enemyCount; i++) {
      // Choose enemy type based on level difficulty
      let availableTypes = ['bouncingBall']; // Always have bouncing balls
      if (difficulty >= 2) availableTypes.push('rollingBall'); // Add rolling balls at stage 2
      if (difficulty >= 3) availableTypes.push('bouncingSquare'); // Add squares at stage 3
      if (difficulty >= 4) availableTypes.push('flyingDrone'); // Add drones at stage 4
      
      const enemyType = availableTypes[Math.floor(Math.random() * availableTypes.length)];
      
      if (enemyType === 'rollingBall') {
        // Rolling balls on ground
        enemies.push({
          x: 400 + i * (levelLength / enemyCount) + Math.random() * 200,
          y: CANVAS_HEIGHT - 125,
          type: 'rollingBall',
          color: currentTheme.enemyColor,
          speed: 1.5 + Math.random() * 1.5,
          direction: Math.random() > 0.5 ? 1 : -1,
          radius: 20
        });
      } else if (enemyType === 'flyingDrone' && difficulty >= 4) {
        // Flying drones move in sine wave pattern
        enemies.push({
          x: 500 + i * (levelLength / enemyCount) + Math.random() * 200,
          y: CANVAS_HEIGHT - 200,
          type: 'flyingDrone',
          color: currentTheme.enemyColor,
          baseY: CANVAS_HEIGHT - 200,
          amplitude: 50,
          frequency: 0.02,
          speed: 1
        });
      } else if (enemyType === 'bouncingSquare') {
        // Bouncing squares on ground
        enemies.push({
          x: 400 + i * (levelLength / enemyCount) + Math.random() * 200,
          y: CANVAS_HEIGHT - 125,
          type: 'bouncingSquare',
          color: currentTheme.enemyColor,
          speed: 1.5 + Math.random() * 1,
          direction: Math.random() > 0.5 ? 1 : -1,
          size: 25,
          bounceHeight: 30,
          bounceSpeed: 0.1
        });
      } else if (usablePlatforms.length > 0) {
        // Platform-based enemies (only bouncing balls now)
        const platform = usablePlatforms[Math.floor(Math.random() * usablePlatforms.length)];
        
        if (enemyType === 'bouncingBall') {
          enemies.push({
            x: platform.x + platform.width / 2,
            y: platform.y - 30,
            type: 'bouncingBall',
            platformIndex: platform.index,
            platformX: platform.x,
            platformWidth: platform.width,
            color: currentTheme.enemyColor,
            bounceHeight: 60,
            bounceSpeed: 0.05,
            radius: 15
          });
        }
      }
    }
    
    // Generate waypoints with INCREASING spacing based on difficulty
    const baseWaypointSpacing = 800; // Base spacing for stage 1
    const waypointSpacing = baseWaypointSpacing + (difficulty - 1) * 400; // Increases by 400 each stage
    const waypointCount = Math.floor(levelLength / waypointSpacing);
    
    for (let i = 1; i <= waypointCount; i++) {
      waypoints.push({
        x: i * waypointSpacing,
        y: CANVAS_HEIGHT - 100,
        id: i,
        activated: false
      });
    }
    
    // Place breakable boxes
    const boxCount = 6 + difficulty * 2;
    for (let i = 0; i < boxCount; i++) {
      const useGround = Math.random() > 0.5;
      
      if (useGround) {
        boxes.push({
          x: 400 + i * (levelLength / boxCount) + Math.random() * 200,
          y: CANVAS_HEIGHT - 130,
          width: 30,
          height: 30,
          broken: false,
          coins: 3 + Math.floor(Math.random() * 3),
          platformIndex: 0  // Ground platform
        });
      } else {
        const platform = platforms[Math.floor(Math.random() * platforms.length)];
        if (platform && platform.type !== 'ground') {
          boxes.push({
            x: platform.x + Math.random() * (platform.width - 30),
            y: platform.y - 30,
            width: 30,
            height: 30,
            broken: false,
            coins: 3 + Math.floor(Math.random() * 3),
            platformIndex: platform.index
          });
        }
      }
    }
    
    // Place treasure chests
    const chestCount = 1 + Math.floor(difficulty / 2);
    for (let i = 0; i < chestCount; i++) {
      const platform = usablePlatforms[Math.floor(Math.random() * usablePlatforms.length)];
      if (platform) {
        chests.push({
          x: platform.x + platform.width / 2 - 20,
          y: platform.y - 35,
          width: 40,
          height: 35,
          opened: false,
          powerUp: Math.random() > 0.5 ? 'speed' : 'shield',
          platformIndex: platform.index
        });
      }
    }
    
    // Few scattered coins
    const coinCount = 8 + difficulty * 2;
    for (let i = 0; i < coinCount; i++) {
      const x = 300 + i * (levelLength / coinCount) + Math.random() * 100;
      collectibles.push({
        x,
        y: CANVAS_HEIGHT - 130 - Math.random() * 50,
        type: 'coin',
        value: 10,
        platformIndex: 0  // On ground
      });
    }
    
    // Gems on higher platforms
    const highPlatforms = platforms.filter(p => p.tier >= 2);
    for (let i = 0; i < Math.min(difficulty, highPlatforms.length); i++) {
      const highPlatform = highPlatforms[i];
      collectibles.push({
        x: highPlatform.x + highPlatform.width / 2,
        y: highPlatform.y - 30,
        type: 'gem',
        value: 50,
        platformIndex: highPlatform.index
      });
    }
    
    // Generate obstacles - mix of spikes and pits
    const obstacleCount = 5 + difficulty * 2;
    for (let i = 0; i < obstacleCount; i++) {
      const x = 500 + i * (levelLength / obstacleCount) + Math.random() * 100;
      
      obstacles.push({
        x,
        y: CANVAS_HEIGHT - 100,
        type: Math.random() > 0.5 ? 'spike' : 'pit',
        width: 45,
        height: 30
      });
    }
    
    return {
      platforms,
      enemies,
      collectibles,
      obstacles,
      waypoints,
      boxes,
      chests,
      levelLength,
      doorPosition: { x: levelLength, y: CANVAS_HEIGHT - 180 },
      theme: {
        backgroundColor: currentTheme.bg,
        platformColor: currentTheme.platform,
        accentColor: currentTheme.color,
        gradient1: currentTheme.gradient1,
        gradient2: currentTheme.gradient2,
        particleColor: currentTheme.particle,
        enemyColor: currentTheme.enemyColor
      },
      levelName: themeName + ' - Stage ' + difficulty,
      levelDescription: 'Reach the door! Waypoints save your progress.'
    };
  };

  const generateLevel = async (levelToGenerate = null, themeToUse = null) => {
    setIsGenerating(true);
    const actualLevel = levelToGenerate !== null ? levelToGenerate : level;
    const currentTheme = themeToUse || theme;
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const levelInfo = createLevel(currentTheme, actualLevel);
    setLevelData(levelInfo);
    gameRefs.current.levelLength = levelInfo.levelLength;
    
    // Reset player position - properly on ground
    gameRefs.current.player.x = 150;
    gameRefs.current.player.y = CANVAS_HEIGHT - 150;
    gameRefs.current.camera.x = 0;
    gameRefs.current.doorReached = false;
    
    setGameState('playing');
    setIsGenerating(false);
  };

  const createParticle = (x, y, color, count = 5) => {
    for (let i = 0; i < count; i++) {
      gameRefs.current.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 8,
        vy: Math.random() * -10 - 2,
        life: 1,
        size: Math.random() * 6 + 2,
        color: color || '#ffffff'
      });
    }
  };

  const respawnFromWaypoint = () => {
    // Only used when continuing after game over
    if (checkpoint) {
      gameRefs.current.player.x = checkpoint.x;
      gameRefs.current.player.y = checkpoint.y - 50;
      gameRefs.current.camera.x = Math.max(0, checkpoint.x - CANVAS_WIDTH / 2);
    } else {
      gameRefs.current.player.x = 150;
      gameRefs.current.player.y = CANVAS_HEIGHT - 150;
      gameRefs.current.camera.x = 0;
    }
    gameRefs.current.player.vx = 0;
    gameRefs.current.player.vy = 0;
    gameRefs.current.player.speedBoost = 1;
    gameRefs.current.player.hasShield = false;
    gameRefs.current.player.invulnerable = true;
    setIsInvulnerable(true);
    setPowerUp(null);
    setPowerUpTimer(0);
    setLives(3); // Reset lives
    setTimeout(() => { 
      gameRefs.current.player.invulnerable = false;
      setIsInvulnerable(false);
    }, 2000);
  };

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && gameState === 'playing') {
      setShowMenu(prev => !prev);
    }
    gameRefs.current.keys[e.key] = true;
  }, [gameState]);

  const handleKeyUp = useCallback((e) => {
    gameRefs.current.keys[e.key] = false;
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);



  const updateGame = useCallback((currentTime) => {
    if (gameState !== 'playing' || !levelData || showMenu) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const game = gameRefs.current;
    const { player, camera, particles, keys } = game;
    
    if (!game.lastFrameTime) game.lastFrameTime = currentTime;
    const deltaTime = Math.min((currentTime - game.lastFrameTime) / 16.67, 2);
    game.lastFrameTime = currentTime;
    game.time += deltaTime;

    // Background
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, levelData.theme.gradient1);
    gradient.addColorStop(1, levelData.theme.gradient2);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Parallax background elements
    ctx.save();
    ctx.globalAlpha = 0.2;
    const parallaxOffset = camera.x * 0.3;
    for (let i = 0; i < 20; i++) {
      const bgX = ((i * 200 - parallaxOffset) % (CANVAS_WIDTH * 2)) - 100;
      const bgY = 100 + Math.sin(i * 2) * 50;
      ctx.fillStyle = levelData.theme.particleColor;
      ctx.beginPath();
      ctx.arc(bgX, bgY, 20 + Math.sin(i) * 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Player input
    player.running = false;
    
    // Apply speed boost if active
    const currentSpeed = RUN_SPEED * player.speedBoost;
    
    if (keys['ArrowLeft'] || keys['a']) {
      player.vx = -currentSpeed;
      player.facing = 'left';
      player.running = true;
    } else if (keys['ArrowRight'] || keys['d']) {
      player.vx = currentSpeed;
      player.facing = 'right';
      player.running = true;
    } else {
      player.vx *= 0.8;
    }

    if ((keys['ArrowUp'] || keys['w'] || keys[' ']) && player.grounded) {
      player.vy = JUMP_FORCE;
      player.jumping = true;
      player.grounded = false;
      player.doubleJumpUsed = false; // Reset double jump when jumping from ground
      createParticle(player.x + player.width / 2, player.y + player.height, levelData.theme.accentColor, 3);
    } else if ((keys['ArrowUp'] || keys['w'] || keys[' ']) && !player.grounded && !player.doubleJumpUsed && player.vy > 0) {
      // Double jump - only when falling and not used yet
      player.vy = JUMP_FORCE * 0.8;
      player.doubleJumpUsed = true;
      createParticle(player.x + player.width / 2, player.y + player.height / 2, '#22c55e', 8);
    }
    
    // Update power-up timer
    if (powerUpTimer > 0) {
      setPowerUpTimer(prev => prev - deltaTime);
      if (powerUpTimer <= deltaTime) {
        setPowerUp(null);
        player.speedBoost = 1;
        player.hasShield = false;
      }
    }
    
    // Update waypoint message timer
    if (waypointMessageTimer > 0) {
      setWaypointMessageTimer(prev => prev - deltaTime);
      if (waypointMessageTimer <= deltaTime) {
        setWaypointMessage('');
      }
    }
    
    // Update damage flash
    if (damageFlash > 0) {
      setDamageFlash(prev => Math.max(0, prev - 0.05));
    }
    
    // Update hurt message timer
    if (hurtMessageTimer > 0) {
      setHurtMessageTimer(prev => {
        const newTimer = prev - deltaTime;
        if (newTimer <= 0) {
          setHurtMessage('');
          return 0;
        }
        return newTimer;
      });
    }

    // Physics
    player.vy += GRAVITY * deltaTime;
    player.vy = Math.min(player.vy, 25);
    player.x += player.vx * deltaTime;
    player.y += player.vy * deltaTime;

    // Boundaries
    if (player.x < 0) player.x = 0;
    if (player.x > game.levelLength + 300) player.x = game.levelLength + 300;

    // Camera follow with smooth interpolation
    const targetCameraX = player.x - CANVAS_WIDTH / 2;
    camera.x += (targetCameraX - camera.x) * 0.1;
    camera.x = Math.max(0, Math.min(camera.x, game.levelLength - CANVAS_WIDTH + 500));

    // Update level progress
    const progressPercent = Math.min(100, (player.x / game.levelLength) * 100);
    setLevelProgress(progressPercent);

    // Animation frame update
    if (player.running) {
      player.animFrame += 0.3 * deltaTime;
    } else {
      player.animFrame = 0;
    }

    // Platform collision
    player.grounded = false;
    let isOverPit = false;

    // 2026-05-11 — Pit detection rewritten. Was: required player to be 15px
    // deep into pit x-range AND feet within +/-10px of pit y. Result: walking
    // onto a pit edge didn't trigger fall-through, and the y-band missed
    // when the player's feet had any jitter. User screenshot showed character
    // standing ON a pit pillar instead of falling in.
    // New rule: any horizontal overlap between player body and a pit
    // counts as "over pit" — we let the ground-platform skip below take
    // care of the rest. The pit always sits at ground level (obstacle.y),
    // so there's no need to vertically gate the check.
    levelData.obstacles.forEach((obstacle) => {
      if (obstacle.type === 'pit' &&
          player.x + player.width > obstacle.x &&
          player.x < obstacle.x + obstacle.width) {
        isOverPit = true;
      }
    });
    
    let standingPlatformState = null;
    
    levelData.platforms.forEach((platform, index) => {
      let platformY = platform.y;
      let platformX = platform.x;
      
      // Handle moving platforms
      if (platform.type === 'moving') {
        if (!game.platformStates.has(index)) {
          game.platformStates.set(index, { offset: 0, direction: 1 });
        }
        const state = game.platformStates.get(index);
        state.offset += platform.moveSpeed * state.direction * deltaTime;
        
        if (Math.abs(state.offset) > platform.moveRange) {
          state.direction *= -1;
        }
        
        if (platform.moveDirection === 'vertical') {
          platformY = platform.y + state.offset;
        } else if (platform.moveDirection === 'horizontal') {
          platformX = platform.x + state.offset;
        }
      }

      // Check collision
      if (player.x < platformX + platform.width &&
          player.x + player.width > platformX &&
          player.y < platformY + platform.height &&
          player.y + player.height > platformY) {
        
        if (player.vy > 0 && player.y < platformY) {
          // Don't land on ground platform if over a pit
          if (platform.type === 'ground' && isOverPit) {
            return; // Skip this collision, let player fall through
          }
          
          player.y = platformY - player.height;
          player.vy = 0;
          player.grounded = true;
          player.jumping = false;
          player.doubleJumpUsed = false; // Reset double jump on landing
          
          // Track which platform player is standing on (for moving platforms)
          if (platform.type === 'moving') {
            standingPlatformState = game.platformStates.get(index);
          }
          
          // Handle special platform types
          if (platform.type === 'bouncy') {
            player.vy = JUMP_FORCE * 1.5;
            createParticle(platformX + platform.width / 2, platformY, '#ffeb3b', 8);
          } else if (platform.type === 'crumbling') {
            const stateKey = 'crumble-' + index;
            if (!game.platformStates.has(stateKey)) {
              game.platformStates.set(stateKey, { timer: 0, crumbling: true });
            }
          }
        }
      }

      // Handle crumbling platforms
      if (platform.type === 'crumbling') {
        const stateKey = 'crumble-' + index;
        if (game.platformStates.has(stateKey)) {
          const state = game.platformStates.get(stateKey);
          if (state.crumbling) {
            state.timer += deltaTime;
            if (state.timer > 30) {
              platform.opacity = Math.max(0, 1 - (state.timer - 30) / 20);
              if (state.timer > 50) {
                platform.type = 'gone';
              }
            }
          }
        }
      }

      // Draw platform
      if (platform.type !== 'gone') {
        const screenX = platformX - camera.x;
        const screenY = platformY;
        
        if (screenX > -platform.width && screenX < CANVAS_WIDTH) {
          ctx.save();
          ctx.globalAlpha = platform.opacity || 1;
          
          if (platform.type === 'ground') {
            const groundGradient = ctx.createLinearGradient(0, screenY, 0, screenY + platform.height);
            groundGradient.addColorStop(0, levelData.theme.platformColor);
            groundGradient.addColorStop(1, levelData.theme.gradient2);
            ctx.fillStyle = groundGradient;
          } else if (platform.type === 'bouncy') {
            ctx.fillStyle = levelData.theme.accentColor;
            ctx.shadowBlur = 15;
            ctx.shadowColor = levelData.theme.accentColor;
          } else {
            ctx.fillStyle = levelData.theme.platformColor;
          }
          
          ctx.fillRect(screenX, screenY, platform.width, platform.height);
          
          // Platform decorations
          if (platform.type === 'moving') {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(screenX + platform.width / 2 - 10, screenY + 5, 20, 4);
          }
          
          ctx.restore();
        }
      }
    });

    // Apply moving platform velocity to player if standing on one
    if (standingPlatformState && player.grounded) {
      // Find the platform this state belongs to
      levelData.platforms.forEach((platform, index) => {
        if (platform.type === 'moving' && game.platformStates.get(index) === standingPlatformState) {
          const moveSpeed = platform.moveSpeed * standingPlatformState.direction * deltaTime;
          if (platform.moveDirection === 'horizontal') {
            player.x += moveSpeed;
          } else if (platform.moveDirection === 'vertical') {
            player.y += moveSpeed;
          }
        }
      });
    }

    // Waypoints
    levelData.waypoints.forEach((waypoint) => {
      if (!game.passedWaypoints.has(waypoint.id)) {
        if (Math.abs(player.x - waypoint.x) < 50) {
          game.passedWaypoints.add(waypoint.id);
          waypoint.activated = true;
          setCheckpoint(waypoint);
          createParticle(waypoint.x, waypoint.y - 50, '#4ade80', 30);
          setScore(prev => prev + 100);
        }
      }
      
      const screenX = waypoint.x - camera.x;
      if (screenX > -50 && screenX < CANVAS_WIDTH) {
        ctx.save();
        
        // Platform under waypoint
        ctx.fillStyle = waypoint.activated ? '#4ade80' : '#6b7280';
        ctx.fillRect(screenX - 30, waypoint.y - 10, 60, 10);
        
        // Flag pole
        ctx.fillStyle = '#374151';
        ctx.fillRect(screenX - 3, waypoint.y - 100, 6, 100);
        
        // Flag
        const flagColor = waypoint.activated ? '#4ade80' : '#ef4444';
        ctx.fillStyle = flagColor;
        ctx.beginPath();
        ctx.moveTo(screenX + 3, waypoint.y - 100);
        ctx.lineTo(screenX + 45, waypoint.y - 80);
        ctx.lineTo(screenX + 3, waypoint.y - 60);
        ctx.closePath();
        ctx.fill();
        
        // Waypoint number
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(waypoint.id.toString(), screenX + 24, waypoint.y - 75);
        
        // Glow effect for activated waypoints
        if (waypoint.activated) {
          ctx.shadowBlur = 30;
          ctx.shadowColor = '#4ade80';
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 3;
          ctx.strokeRect(screenX - 35, waypoint.y - 105, 70, 110);
        }
        
        // Info text
        if (!waypoint.activated && Math.abs(player.x - waypoint.x) < 200) {
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('WAYPOINT', screenX, waypoint.y - 115);
        }
        
        ctx.restore();
      }
    });

    // Enemies
    levelData.enemies.forEach((enemy, index) => {
      if (game.defeatedEnemies.has(index)) return;
      
      const state = game.enemyStates.get(index) || {
        x: enemy.x,
        y: enemy.y,
        vx: enemy.speed || 1,
        vy: 0,
        time: 0,
        direction: enemy.direction || 1
      };
      
      state.time += deltaTime;
      
      // Enemy movement based on type
      if (enemy.type === 'bouncingBall') {
        // Bouncing ball - stays in place, bounces up and down
        state.x = enemy.x;
        state.y = enemy.y - Math.abs(Math.sin(state.time * enemy.bounceSpeed)) * enemy.bounceHeight;
        
      } else if (enemy.type === 'rollingBall') {
        // Rolling ball - rolls back and forth on ground
        const nextX = state.x + enemy.speed * state.direction * deltaTime;
        // 2026-05-08 — Pit avoidance. Enemies used to walk straight off pits
        // and disappear. Now we look ahead one frame and reverse direction
        // if the next position would put the enemy's center over a pit.
        const aboutToEnterPit = levelData.obstacles.some(o =>
          o.type === 'pit' &&
          nextX + 16 > o.x && nextX - 16 < o.x + o.width
        );
        if (aboutToEnterPit) state.direction *= -1;
        else state.x = nextX;
        state.y = enemy.y;

        // Reverse direction at patrol boundaries
        if (state.x < enemy.x - 150 || state.x > enemy.x + 150) {
          state.direction *= -1;
        }

      } else if (enemy.type === 'bouncingSquare') {
        // Bouncing square - moves back and forth on ground with bouncing
        const nextX = state.x + enemy.speed * state.direction * deltaTime;
        const aboutToEnterPit = levelData.obstacles.some(o =>
          o.type === 'pit' &&
          nextX + 16 > o.x && nextX - 16 < o.x + o.width
        );
        if (aboutToEnterPit) state.direction *= -1;
        else state.x = nextX;

        // Reverse direction at patrol boundaries
        if (state.x < enemy.x - 150 || state.x > enemy.x + 150) {
          state.direction *= -1;
        }

        // Bounce animation
        state.y = enemy.y - Math.abs(Math.sin(state.time * enemy.bounceSpeed)) * enemy.bounceHeight;

      } else if (enemy.type === 'flyingDrone') {
        // Flying drone - moves in sine wave pattern
        state.x += enemy.speed * deltaTime;
        state.y = enemy.baseY + Math.sin(state.x * enemy.frequency) * enemy.amplitude;
        
        // Loop around
        if (state.x > enemy.x + 400) {
          state.x = enemy.x - 100;
        }
      }
      
      game.enemyStates.set(index, state);
      
      // Collision with player
      let collisionRadius = 25;
      if (enemy.type === 'bouncingBall' || enemy.type === 'rollingBall') {
        collisionRadius = enemy.radius || 20;
      } else if (enemy.type === 'bouncingSquare') {
        collisionRadius = enemy.size || 25;
      }
      
      const dist = Math.sqrt(
        Math.pow(player.x + player.width / 2 - state.x, 2) +
        Math.pow(player.y + player.height / 2 - state.y, 2)
      );
      
      if (dist < collisionRadius + 15) {
        if (player.vy > 0 && player.y < state.y - 10) {
          // Defeat enemy by jumping on it
          game.defeatedEnemies.add(index);
          setScore(prev => prev + 50);
          player.vy = JUMP_FORCE * 0.7;
          createParticle(state.x, state.y, enemy.color, 15);
        } else if (!player.invulnerable) {
          // Take damage but check for shield first
          if (player.hasShield) {
            // Shield blocks the damage
            player.hasShield = false;
            setPowerUp(null);
            setPowerUpTimer(0);
            createParticle(player.x + player.width / 2, player.y + player.height / 2, '#3b82f6', 20);
            
            // Small knockback but no damage
            player.vx = (player.x > state.x ? 1 : -1) * 5;
            player.vy = -5;
            
            // Brief invulnerability
            player.invulnerable = true;
            setIsInvulnerable(true);
            setTimeout(() => { 
              gameRefs.current.player.invulnerable = false;
              setIsInvulnerable(false);
            }, 1000);
          } else {
            // No shield - take damage
            setLives(prev => prev - 1);
            createParticle(player.x + player.width / 2, player.y + player.height / 2, '#ef4444', 10);
            setDamageFlash(1); // Trigger damage flash
            
            // Random hurt messages
            const messages = ['Ouch!', 'Ow!', 'Hey!', 'Oof!'];
            setHurtMessage(messages[Math.floor(Math.random() * messages.length)]);
            setHurtMessageTimer(120); // 2 seconds at 60fps
            
            // Knockback effect
            player.vx = (player.x > state.x ? 1 : -1) * 10;
            player.vy = -8;
            
            if (lives <= 1) {
              setGameState('gameOver');
            }
            
            // Make player invulnerable for 2 seconds
            player.invulnerable = true;
            setIsInvulnerable(true);
            setTimeout(() => { 
              gameRefs.current.player.invulnerable = false;
              setIsInvulnerable(false);
            }, 2000);
          }
        }
      }
      
      // Draw enemy
      const screenX = state.x - camera.x;
      if (screenX > -50 && screenX < CANVAS_WIDTH + 50) {
        ctx.save();
        ctx.translate(screenX, state.y);
        
        if (enemy.type === 'bouncingBall') {
          // Bouncing ball - colorful orb with glow
          const squash = 1 + Math.sin(state.time * enemy.bounceSpeed * 2) * 0.15;
          ctx.scale(1 / squash, squash);
          
          // Glow effect
          ctx.shadowBlur = 25;
          ctx.shadowColor = enemy.color;
          
          // Ball gradient
          const ballGradient = ctx.createRadialGradient(0, -3, 0, 0, -3, enemy.radius);
          ballGradient.addColorStop(0, 'rgba(255,255,255,0.5)');
          ballGradient.addColorStop(0.5, enemy.color);
          ballGradient.addColorStop(1, enemy.color);
          ctx.fillStyle = ballGradient;
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius, 0, Math.PI * 2);
          ctx.fill();
          
          // Shine
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.beginPath();
          ctx.arc(-enemy.radius/3, -enemy.radius/3, enemy.radius/3, 0, Math.PI * 2);
          ctx.fill();
          
          // Mean face
          ctx.fillStyle = 'black';
          // Angry eyes
          ctx.fillRect(-enemy.radius/2, -enemy.radius/4, enemy.radius/4, enemy.radius/5);
          ctx.fillRect(enemy.radius/4, -enemy.radius/4, enemy.radius/4, enemy.radius/5);
          // Frown
          ctx.beginPath();
          ctx.arc(0, enemy.radius/4, enemy.radius/3, 0.3, Math.PI - 0.3);
          ctx.lineWidth = 2;
          ctx.stroke();
          // Angry eyebrows
          ctx.beginPath();
          ctx.moveTo(-enemy.radius/2, -enemy.radius/2.5);
          ctx.lineTo(-enemy.radius/4, -enemy.radius/3);
          ctx.moveTo(enemy.radius/2, -enemy.radius/2.5);
          ctx.lineTo(enemy.radius/4, -enemy.radius/3);
          ctx.stroke();
          
          // Mean face
          ctx.fillStyle = 'white';
          ctx.beginPath();
          ctx.arc(-5, -3, 3, 0, Math.PI * 2);
          ctx.arc(5, -3, 3, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = 'black';
          ctx.beginPath();
          ctx.arc(-5, -3, 1.5, 0, Math.PI * 2);
          ctx.arc(5, -3, 1.5, 0, Math.PI * 2);
          ctx.fill();
          
          // Angry eyebrows
          ctx.strokeStyle = 'black';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-8, -6);
          ctx.lineTo(-3, -5);
          ctx.moveTo(8, -6);
          ctx.lineTo(3, -5);
          ctx.stroke();
          
          // Mean frown
          ctx.beginPath();
          ctx.arc(0, 2, 4, 0.2, Math.PI - 0.2);
          ctx.stroke();
          
        } else if (enemy.type === 'rollingBall') {
          // Rolling ball with rotation
          const rotation = (state.x / 20) * state.direction;
          ctx.rotate(rotation);
          
          // Ball body
          ctx.fillStyle = enemy.color;
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius, 0, Math.PI * 2);
          ctx.fill();
          
          // Rolling pattern
          ctx.strokeStyle = 'rgba(0,0,0,0.3)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-enemy.radius, 0);
          ctx.lineTo(enemy.radius, 0);
          ctx.moveTo(0, -enemy.radius);
          ctx.lineTo(0, enemy.radius);
          ctx.stroke();
          
          // Eyes that look mean
          ctx.fillStyle = 'white';
          ctx.beginPath();
          ctx.arc(-6, -5, 4, 0, Math.PI * 2);
          ctx.arc(6, -5, 4, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = 'black';
          ctx.beginPath();
          ctx.arc(-6, -5, 2, 0, Math.PI * 2);
          ctx.arc(6, -5, 2, 0, Math.PI * 2);
          ctx.fill();
          
          // Angry eyebrows
          ctx.strokeStyle = 'black';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-9, -8);
          ctx.lineTo(-4, -7);
          ctx.moveTo(9, -8);
          ctx.lineTo(4, -7);
          ctx.stroke();
          
          // Mean frown
          ctx.beginPath();
          ctx.arc(0, 2, 5, 0.3, Math.PI - 0.3);
          ctx.stroke();
          
        } else if (enemy.type === 'bouncingSquare') {
          // Bouncing square with personality
          const stretch = state.y < enemy.y ? 1.1 : 1;
          const squash = state.y < enemy.y ? 0.9 : 1;
          ctx.scale(stretch, squash);
          
          // Main body
          ctx.fillStyle = enemy.color;
          ctx.fillRect(-enemy.size/2, -enemy.size/2, enemy.size, enemy.size);
          
          // Face - mean expression
          ctx.fillStyle = 'white';
          ctx.fillRect(-enemy.size/2 + 5, -enemy.size/2 + 5, 6, 6);
          ctx.fillRect(enemy.size/2 - 11, -enemy.size/2 + 5, 6, 6);
          
          // Mean pupils
          ctx.fillStyle = 'black';
          ctx.fillRect(-enemy.size/2 + 7, -enemy.size/2 + 7, 3, 3);
          ctx.fillRect(enemy.size/2 - 9, -enemy.size/2 + 7, 3, 3);
          
          // Very angry eyebrows
          ctx.strokeStyle = 'black';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(-enemy.size/2 + 3, -enemy.size/2 + 2);
          ctx.lineTo(-enemy.size/2 + 11, -enemy.size/2 + 5);
          ctx.moveTo(enemy.size/2 - 3, -enemy.size/2 + 2);
          ctx.lineTo(enemy.size/2 - 11, -enemy.size/2 + 5);
          ctx.stroke();
          
          // Mean frown mouth
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-6, enemy.size/2 - 8);
          ctx.quadraticCurveTo(0, enemy.size/2 - 6, 6, enemy.size/2 - 8);
          ctx.stroke();
          
        } else if (enemy.type === 'flyingDrone') {
          // Flying drone with propellers
          const propellerSpin = state.time * 0.5;
          
          // Body
          ctx.fillStyle = '#4a5568';
          ctx.fillRect(-15, -8, 30, 16);
          
          // Propellers
          ctx.save();
          ctx.fillStyle = '#9ca3af';
          // Left propeller
          ctx.translate(-10, -10);
          ctx.rotate(propellerSpin);
          ctx.fillRect(-15, -2, 30, 4);
          ctx.restore();
          
          ctx.save();
          // Right propeller
          ctx.translate(10, -10);
          ctx.rotate(-propellerSpin);
          ctx.fillRect(-15, -2, 30, 4);
          ctx.restore();
          
          // Eye (sensor)
          ctx.fillStyle = enemy.color;
          ctx.shadowBlur = 10;
          ctx.shadowColor = enemy.color;
          ctx.beginPath();
          ctx.arc(0, 0, 6, 0, Math.PI * 2);
          ctx.fill();
          
          // Scanning light
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath();
          ctx.arc(0, 0, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        
        ctx.restore();
      }
    });

    // Breakable Boxes
    if (levelData.boxes) {
      levelData.boxes.forEach((box, index) => {
        if (game.brokenBoxes.has(index)) return;
        
        let boxX = box.x;
        let boxY = box.y;
        
        // If box is on a moving platform, move it with the platform
        if (box.platformIndex !== undefined) {
          const platform = levelData.platforms.find(p => p.index === box.platformIndex);
          if (platform && platform.type === 'moving') {
            const platformIndex = levelData.platforms.indexOf(platform);
            const state = game.platformStates.get(platformIndex);
            if (state) {
              if (platform.moveDirection === 'horizontal') {
                boxX = box.x + state.offset;
              } else if (platform.moveDirection === 'vertical') {
                boxY = box.y + state.offset;
              }
            }
          }
        }
        
        // Check if player jumped on box
        if (player.y + player.height >= boxY &&
            player.y < boxY + box.height &&
            player.x < boxX + box.width &&
            player.x + player.width > boxX &&
            player.vy > 0) {
          
          // Break the box
          game.brokenBoxes.add(index);
          setCoins(prev => prev + box.coins);
          setScore(prev => prev + box.coins * 10);
          player.vy = JUMP_FORCE * 0.5;
          
          // Explosion of coins
          for (let i = 0; i < box.coins; i++) {
            const angle = (Math.PI * 2 / box.coins) * i;
            createParticle(
              boxX + box.width / 2 + Math.cos(angle) * 10,
              boxY + Math.sin(angle) * 10,
              '#fbbf24',
              1
            );
          }
          
          // Wood particles
          for (let i = 0; i < 10; i++) {
            createParticle(boxX + box.width / 2, boxY, '#8b4513', 1);
          }
        }
        
        // Draw box
        const screenX = boxX - camera.x;
        if (screenX > -50 && screenX < CANVAS_WIDTH + 50) {
          ctx.save();
          
          // Box shadow
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.fillRect(screenX + 2, boxY + 2, box.width, box.height);
          
          // Main box
          ctx.fillStyle = '#8b4513';
          ctx.fillRect(screenX, boxY, box.width, box.height);
          
          // Wood grain
          ctx.strokeStyle = '#654321';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(screenX + 5, boxY);
          ctx.lineTo(screenX + 5, boxY + box.height);
          ctx.moveTo(screenX + 15, boxY);
          ctx.lineTo(screenX + 15, boxY + box.height);
          ctx.moveTo(screenX + 25, boxY);
          ctx.lineTo(screenX + 25, boxY + box.height);
          ctx.stroke();
          
          // Question mark
          ctx.fillStyle = '#fbbf24';
          ctx.font = 'bold 18px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('?', screenX + box.width / 2, boxY + box.height / 2 + 6);
          
          // Highlight
          ctx.fillStyle = 'rgba(255,255,255,0.2)';
          ctx.fillRect(screenX + 2, boxY + 2, box.width - 4, 6);
          
          ctx.restore();
        }
      });
    }
    
    // Treasure Chests
    if (levelData.chests) {
      levelData.chests.forEach((chest, index) => {
        if (game.openedChests.has(index)) return;
        
        let chestX = chest.x;
        let chestY = chest.y;
        
        // If chest is on a moving platform, move it with the platform
        if (chest.platformIndex !== undefined) {
          const platform = levelData.platforms.find(p => p.index === chest.platformIndex);
          if (platform && platform.type === 'moving') {
            const platformIndex = levelData.platforms.indexOf(platform);
            const state = game.platformStates.get(platformIndex);
            if (state) {
              if (platform.moveDirection === 'horizontal') {
                chestX = chest.x + state.offset;
              } else if (platform.moveDirection === 'vertical') {
                chestY = chest.y + state.offset;
              }
            }
          }
        }
        
        // Check if player is near chest
        const dist = Math.abs(player.x + player.width / 2 - (chestX + chest.width / 2));
        
        if (dist < 40 && Math.abs(player.y - chestY) < 50) {
          // Open chest
          game.openedChests.add(index);
          
          // Apply power-up
          if (chest.powerUp === 'speed') {
            player.speedBoost = 1.5;
            setPowerUp('speed');
            setPowerUpTimer(300); // 5 seconds at 60fps
            createParticle(chestX + chest.width / 2, chestY, '#22c55e', 20);
          } else if (chest.powerUp === 'shield') {
            player.hasShield = true;
            setPowerUp('shield');
            createParticle(chestX + chest.width / 2, chestY, '#3b82f6', 20);
          }
          
          setScore(prev => prev + 200);
        }
        
        // Draw chest
        const screenX = chestX - camera.x;
        if (screenX > -50 && screenX < CANVAS_WIDTH + 50) {
          ctx.save();
          
          const isNear = dist < 60;
          
          // Chest shadow
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(screenX + 3, chestY + 3, chest.width, chest.height);
          
          // Main chest body
          const chestGradient = ctx.createLinearGradient(screenX, chestY, screenX, chestY + chest.height);
          chestGradient.addColorStop(0, '#8b4513');
          chestGradient.addColorStop(1, '#654321');
          ctx.fillStyle = chestGradient;
          ctx.fillRect(screenX, chestY + 10, chest.width, chest.height - 10);
          
          // Chest lid (opens when near)
          ctx.save();
          if (isNear) {
            ctx.translate(screenX, chestY + 10);
            ctx.rotate(-0.3);
            ctx.translate(-screenX, -chestY - 10);
          }
          ctx.fillStyle = '#a0522d';
          ctx.fillRect(screenX, chestY, chest.width, 12);
          ctx.restore();
          
          // Gold trim
          ctx.strokeStyle = '#ffd700';
          ctx.lineWidth = 2;
          ctx.strokeRect(screenX + 2, chestY + 2, chest.width - 4, chest.height - 4);
          
          // Lock
          ctx.fillStyle = '#ffd700';
          ctx.fillRect(screenX + chest.width / 2 - 5, chestY + chest.height / 2 - 5, 10, 10);
          ctx.fillStyle = '#000000';
          ctx.beginPath();
          ctx.arc(screenX + chest.width / 2, chestY + chest.height / 2, 2, 0, Math.PI * 2);
          ctx.fill();
          
          // Glow effect when near
          if (isNear) {
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#ffd700';
            ctx.strokeStyle = '#ffd700';
            ctx.strokeRect(screenX, chestY, chest.width, chest.height);
          }
          
          ctx.restore();
        }
      });
    }

    // Collectibles
    levelData.collectibles.forEach((item, index) => {
      if (game.collectedCoins.has(index)) return;
      
      let itemX = item.x;
      let itemY = item.y;
      
      // If collectible is on a moving platform, move it with the platform
      if (item.platformIndex !== undefined) {
        const platform = levelData.platforms.find(p => p.index === item.platformIndex);
        if (platform && platform.type === 'moving') {
          const state = game.platformStates.get(levelData.platforms.indexOf(platform));
          if (state) {
            if (platform.moveDirection === 'horizontal') {
              itemX = item.x + state.offset;
            } else if (platform.moveDirection === 'vertical') {
              itemY = item.y + state.offset;
            }
          }
        }
      }
      
      const dist = Math.sqrt(
        Math.pow(player.x + player.width / 2 - itemX, 2) +
        Math.pow(player.y + player.height / 2 - itemY, 2)
      );
      
      if (dist < 30) {
        game.collectedCoins.add(index);
        if (item.type === 'coin') {
          setCoins(prev => prev + 1);
          setScore(prev => prev + item.value);
          createParticle(itemX, itemY, '#fbbf24', 8);
        } else if (item.type === 'gem') {
          setScore(prev => prev + item.value);
          createParticle(itemX, itemY, levelData.theme.accentColor, 12);
        }
      }
      
      const screenX = itemX - camera.x;
      if (screenX > -50 && screenX < CANVAS_WIDTH + 50) {
        ctx.save();
        
        const bounce = Math.sin(game.time * 0.1 + index) * 5;
        const rotation = game.time * 0.05;
        
        ctx.translate(screenX, itemY + bounce);
        ctx.rotate(rotation);
        
        if (item.type === 'coin') {
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#fbbf24';
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(0, 0, 10, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = '#f59e0b';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('$', 0, 4);
        } else {
          ctx.shadowBlur = 20;
          ctx.shadowColor = levelData.theme.accentColor;
          ctx.fillStyle = levelData.theme.accentColor;
          ctx.beginPath();
          ctx.moveTo(0, -12);
          ctx.lineTo(-8, 0);
          ctx.lineTo(0, 12);
          ctx.lineTo(8, 0);
          ctx.closePath();
          ctx.fill();
        }
        
        ctx.restore();
      }
    });

    // Obstacles
    levelData.obstacles.forEach((obstacle) => {
      const screenX = obstacle.x - camera.x;
      
      if (screenX > -obstacle.width && screenX < CANVAS_WIDTH) {
        ctx.save();
        
        if (obstacle.type === 'spike') {
          // Spikes coming up from the ground
          ctx.fillStyle = '#9ca3af';
          ctx.strokeStyle = '#6b7280';
          ctx.lineWidth = 1;
          
          // Draw multiple spike triangles
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(screenX + i * 15, obstacle.y);
            ctx.lineTo(screenX + i * 15 + 7.5, obstacle.y - 25);
            ctx.lineTo(screenX + i * 15 + 15, obstacle.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          
          // Add metallic shine
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(screenX + i * 15 + 3, obstacle.y - 5);
            ctx.lineTo(screenX + i * 15 + 6, obstacle.y - 20);
            ctx.lineTo(screenX + i * 15 + 7, obstacle.y - 15);
            ctx.closePath();
            ctx.fill();
          }
        } else if (obstacle.type === 'pit') {
          // Draw pit in the ground
          ctx.fillStyle = '#030712';
          ctx.fillRect(screenX, obstacle.y, obstacle.width, 100);
          
          // Add depth gradient
          const pitGradient = ctx.createLinearGradient(screenX, obstacle.y, screenX, obstacle.y + 30);
          pitGradient.addColorStop(0, 'rgba(3,7,18,0.5)');
          pitGradient.addColorStop(1, '#030712');
          ctx.fillStyle = pitGradient;
          ctx.fillRect(screenX, obstacle.y, obstacle.width, 30);
          
          // Warning stripes on edges
          ctx.fillStyle = '#facc15';
          ctx.fillRect(screenX - 5, obstacle.y - 5, 5, 10);
          ctx.fillRect(screenX + obstacle.width, obstacle.y - 5, 5, 10);
        }
        
        ctx.restore();
        
        // Collision detection for spikes only (pits handled in platform collision)
        if (!player.invulnerable) {
          // Spike collision
          if (obstacle.type === 'spike' &&
              player.x < obstacle.x + obstacle.width &&
              player.x + player.width > obstacle.x &&
              player.y + player.height > obstacle.y - 25 &&
              player.y + player.height < obstacle.y + 5) {
            
            if (!player.invulnerable) {
              setLives(prev => prev - 1);
              createParticle(player.x + player.width / 2, player.y + player.height / 2, '#ef4444', 15);
              setDamageFlash(1); // Trigger damage flash
              
              // Random hurt messages
              const messages = ['Ouch!', 'Ow!', 'Yikes!', 'Oops!'];
              setHurtMessage(messages[Math.floor(Math.random() * messages.length)]);
              setHurtMessageTimer(120); // 2 seconds at 60fps
              
              // Bounce player up and back
              player.vy = -10;
              player.vx = player.facing === 'right' ? -8 : 8;
              
              // Make invulnerable
              player.invulnerable = true;
              setIsInvulnerable(true);
              setTimeout(() => { 
                gameRefs.current.player.invulnerable = false;
                setIsInvulnerable(false);
              }, 2000);
              
              if (lives <= 1) {
                setGameState('gameOver');
              }
            }
          }
        }
      }
    });

    // Draw door (goal)
    const doorScreenX = levelData.doorPosition.x - camera.x;
    if (doorScreenX > -100 && doorScreenX < CANVAS_WIDTH) {
      ctx.save();
      
      // Door frame
      ctx.fillStyle = '#8b5cf6';
      ctx.fillRect(doorScreenX - 5, levelData.doorPosition.y - 5, 70, 85);
      
      // Door
      const doorOpen = Math.abs(player.x - levelData.doorPosition.x) < 100;
      ctx.fillStyle = doorOpen ? '#1f2937' : '#4c1d95';
      ctx.fillRect(doorScreenX, levelData.doorPosition.y, 60, 80);
      
      // Door handle
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(doorScreenX + 45, levelData.doorPosition.y + 40, 4, 0, Math.PI * 2);
      ctx.fill();
      
      // Glow effect when near
      if (doorOpen) {
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#8b5cf6';
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 3;
        ctx.strokeRect(doorScreenX - 5, levelData.doorPosition.y - 5, 70, 85);
        
        // Check if player reached door
        if (!game.doorReached && Math.abs(player.x - levelData.doorPosition.x - 30) < 30) {
          game.doorReached = true;
          setGameState('levelComplete');
        }
      }
      
      ctx.restore();
    }

    // Draw player
    const screenX = player.x - camera.x;
    ctx.save();
    ctx.translate(screenX + player.width / 2, player.y + player.height / 2);
    
    if (player.facing === 'left') ctx.scale(-1, 1);
    
    // Running animation
    const runFrame = Math.floor(player.animFrame) % 4;
    const legOffset = player.running ? Math.sin(runFrame * Math.PI / 2) * 6 : 0;
    const bobOffset = player.running ? Math.abs(Math.sin(runFrame * Math.PI / 2)) * 3 : 0;
    
    // Shield effect
    if (player.hasShield) {
      ctx.save();
      ctx.globalAlpha = 0.4 + Math.sin(game.time * 0.15) * 0.2;
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 4;
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#3b82f6';
      ctx.beginPath();
      ctx.arc(0, 0, 38, 0, Math.PI * 2);
      ctx.stroke();
      
      // Inner shield ring
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    
    // Speed effect
    if (player.speedBoost > 1) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 3;
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#22c55e';
      for (let i = 0; i < 4; i++) {
        const offset = i * 10;
        ctx.beginPath();
        ctx.moveTo(player.facing === 'right' ? -35 - offset : 35 + offset, -18 + i * 12);
        ctx.lineTo(player.facing === 'right' ? -50 - offset : 50 + offset, -18 + i * 12 + (Math.random() * 6 - 3));
        ctx.stroke();
      }
      ctx.restore();
    }
    
    // Invulnerability effect
    if (player.invulnerable) {
      ctx.save();
      const pulse = Math.sin(game.time * 0.4) * 0.4 + 0.6;
      ctx.strokeStyle = `rgba(255, 255, 255, ${pulse})`;
      ctx.lineWidth = 4;
      ctx.shadowBlur = 20;
      ctx.shadowColor = 'white';
      ctx.beginPath();
      ctx.rect(-player.width/2 - 6, -player.height/2 - 6, player.width + 12, player.height + 12);
      ctx.stroke();
      ctx.restore();
      
      if (game.time % 8 < 4) {
        ctx.globalAlpha = 0.7;
      }
    }
    
    // Shadow - larger and softer
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, player.height/2 + 5, 20, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // LEGS - thicker, more detailed
    ctx.strokeStyle = '#1e40af';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Left leg
    ctx.beginPath();
    ctx.moveTo(-7, 10 - bobOffset);
    ctx.lineTo(-7 - legOffset * 0.6, 20 - bobOffset);
    ctx.lineTo(-8 - legOffset, player.height/2 - 1);
    ctx.stroke();
    
    // Right leg  
    ctx.beginPath();
    ctx.moveTo(7, 10 - bobOffset);
    ctx.lineTo(7 + legOffset * 0.6, 20 - bobOffset);
    ctx.lineTo(8 + legOffset, player.height/2 - 1);
    ctx.stroke();
    
    // BOOTS - more detailed with laces
    const bootColor = '#7c2d12';
    const bootHighlight = '#a0522d';
    
    // Left boot
    ctx.fillStyle = bootColor;
    ctx.fillRect(-12 - legOffset, player.height/2 - 5, 10, 8);
    ctx.fillStyle = bootHighlight;
    ctx.fillRect(-11 - legOffset, player.height/2 - 5, 3, 6);
    // Boot sole
    ctx.fillStyle = '#4a2511';
    ctx.fillRect(-12 - legOffset, player.height/2 + 3, 10, 2);
    
    // Right boot
    ctx.fillStyle = bootColor;
    ctx.fillRect(2 + legOffset, player.height/2 - 5, 10, 8);
    ctx.fillStyle = bootHighlight;
    ctx.fillRect(3 + legOffset, player.height/2 - 5, 3, 6);
    // Boot sole
    ctx.fillStyle = '#4a2511';
    ctx.fillRect(2 + legOffset, player.height/2 + 3, 10, 2);
    
    // BODY - more heroic proportions
    const bodyGradient = ctx.createLinearGradient(-14, -10 - bobOffset, 14, 15 - bobOffset);
    bodyGradient.addColorStop(0, '#10b981');
    bodyGradient.addColorStop(1, '#047857');
    ctx.fillStyle = bodyGradient;
    ctx.fillRect(-14, -10 - bobOffset, 28, 24);
    
    // Vest details - make it look like armor
    ctx.fillStyle = '#065f46';
    ctx.fillRect(-14, -10 - bobOffset, 5, 24);
    ctx.fillRect(9, -10 - bobOffset, 5, 24);
    
    // Chest emblem/logo
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.moveTo(0, -5 - bobOffset);
    ctx.lineTo(-4, 1 - bobOffset);
    ctx.lineTo(0, 5 - bobOffset);
    ctx.lineTo(4, 1 - bobOffset);
    ctx.closePath();
    ctx.fill();
    
    // Belt - more detailed
    ctx.fillStyle = bootColor;
    ctx.fillRect(-14, 8 - bobOffset, 28, 5);
    
    // Belt buckle - larger and more prominent
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(-4, 7 - bobOffset, 8, 6);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(-3, 8 - bobOffset, 6, 4);
    ctx.strokeStyle = bootColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(-3, 8 - bobOffset, 6, 4);
    
    // ARMS - more muscular
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    
    // Left arm with natural movement
    ctx.beginPath();
    ctx.moveTo(-13, -5 - bobOffset);
    if (player.running) {
      const leftArmAngle = Math.sin(runFrame * Math.PI / 2) * 0.7;
      ctx.lineTo(-16, 4 - bobOffset);
      ctx.lineTo(-14 - Math.sin(leftArmAngle) * 10, 14 - bobOffset + Math.cos(leftArmAngle) * 10);
    } else {
      ctx.lineTo(-16, 4 - bobOffset);
      ctx.lineTo(-18, 14 - bobOffset);
    }
    ctx.stroke();
    
    // Right arm
    ctx.beginPath();
    ctx.moveTo(13, -5 - bobOffset);
    if (player.running) {
      const rightArmAngle = -Math.sin(runFrame * Math.PI / 2) * 0.7;
      ctx.lineTo(16, 4 - bobOffset);
      ctx.lineTo(14 - Math.sin(rightArmAngle) * 10, 14 - bobOffset + Math.cos(rightArmAngle) * 10);
    } else {
      ctx.lineTo(16, 4 - bobOffset);
      ctx.lineTo(18, 14 - bobOffset);
    }
    ctx.stroke();
    
    // HANDS/GLOVES - bigger and better defined
    ctx.fillStyle = bootHighlight;
    ctx.strokeStyle = bootColor;
    ctx.lineWidth = 1;
    
    if (player.running) {
      const leftArmAngle = Math.sin(runFrame * Math.PI / 2) * 0.7;
      const rightArmAngle = -Math.sin(runFrame * Math.PI / 2) * 0.7;
      
      ctx.beginPath();
      ctx.arc(-14 - Math.sin(leftArmAngle) * 10, 14 - bobOffset + Math.cos(leftArmAngle) * 10, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(14 - Math.sin(rightArmAngle) * 10, 14 - bobOffset + Math.cos(rightArmAngle) * 10, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(-18, 14 - bobOffset, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(18, 14 - bobOffset, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    
    // HEAD - better proportions
    const headGradient = ctx.createRadialGradient(-2, -22 - bobOffset, 2, 0, -20 - bobOffset, 12);
    headGradient.addColorStop(0, '#fef3c7');
    headGradient.addColorStop(1, '#fde68a');
    ctx.fillStyle = headGradient;
    ctx.beginPath();
    ctx.arc(0, -20 - bobOffset, 11, 0, Math.PI * 2);
    ctx.fill();
    
    // Outline for head
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // HAIR - cooler style
    ctx.fillStyle = '#92400e';
    ctx.beginPath();
    // Left hair
    ctx.moveTo(-11, -22 - bobOffset);
    ctx.quadraticCurveTo(-13, -25 - bobOffset, -10, -28 - bobOffset);
    ctx.lineTo(-8, -20 - bobOffset);
    ctx.closePath();
    ctx.fill();
    // Right hair
    ctx.beginPath();
    ctx.moveTo(11, -22 - bobOffset);
    ctx.quadraticCurveTo(13, -25 - bobOffset, 10, -28 - bobOffset);
    ctx.lineTo(8, -20 - bobOffset);
    ctx.closePath();
    ctx.fill();
    
    // EYES - more expressive and heroic
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.ellipse(-5, -22 - bobOffset, 4, 5, 0, 0, Math.PI * 2);
    ctx.ellipse(5, -22 - bobOffset, 4, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Pupils - determined look
    ctx.fillStyle = '#1e3a8a';
    const lookDir = player.running ? 1.5 : 0;
    ctx.beginPath();
    ctx.arc(-5 + lookDir, -21 - bobOffset, 2.5, 0, Math.PI * 2);
    ctx.arc(5 + lookDir, -21 - bobOffset, 2.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Eye shine
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(-5.5 + lookDir, -22 - bobOffset, 1, 0, Math.PI * 2);
    ctx.arc(4.5 + lookDir, -22 - bobOffset, 1, 0, Math.PI * 2);
    ctx.fill();
    
    // EYEBROWS - determined expression
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, -25 - bobOffset);
    ctx.lineTo(-3, -24 - bobOffset);
    ctx.moveTo(8, -25 - bobOffset);
    ctx.lineTo(3, -24 - bobOffset);
    ctx.stroke();
    
    // MOUTH - confident smile or determined look
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (player.running) {
      // Open mouth when running - determined
      ctx.arc(0, -15 - bobOffset, 3, 0.1, Math.PI - 0.1);
    } else {
      // Confident smile
      ctx.arc(0, -16 - bobOffset, 4, 0.2, Math.PI - 0.2);
    }
    ctx.stroke();
    
    // HAT - adventurer/explorer style with better design
    ctx.fillStyle = '#dc2626';
    // Main hat body
    ctx.fillRect(-13, -31 - bobOffset, 26, 9);
    // Hat brim
    ctx.fillRect(-15, -33 - bobOffset, 30, 2);
    // Top of hat
    ctx.fillRect(-11, -34 - bobOffset, 22, 3);
    
    // Hat band detail
    ctx.fillStyle = '#991b1b';
    ctx.fillRect(-13, -26 - bobOffset, 26, 3);
    
    // Hat buckle/emblem
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.rect(-3, -28 - bobOffset, 6, 4);
    ctx.fill();
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Hat shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(-13, -26 - bobOffset, 26, 1);
    
    ctx.restore();

    // Draw hurt message
    if (hurtMessage && hurtMessageTimer > 0) {
      const messageScreenX = player.x - camera.x + player.width / 2;
      const messageScreenY = player.y - camera.y - 40 - (120 - hurtMessageTimer) / 2; // Float upward over 2 seconds
      
      ctx.save();
      ctx.globalAlpha = Math.min(1, hurtMessageTimer / 60); // Fade out in last second
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ef4444';
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 4;
      ctx.strokeText(hurtMessage, messageScreenX, messageScreenY);
      ctx.fillText(hurtMessage, messageScreenX, messageScreenY);
      ctx.restore();
    }

    // Particles
    particles.forEach((particle, index) => {
      particle.x += particle.vx * deltaTime;
      particle.y += particle.vy * deltaTime;
      particle.vy += 0.5 * deltaTime;
      particle.life -= 0.02 * deltaTime;
      
      if (particle.life <= 0) {
        particles.splice(index, 1);
        return;
      }
      
      const particleScreenX = particle.x - camera.x;
      ctx.save();
      ctx.globalAlpha = particle.life;
      ctx.fillStyle = particle.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = particle.color;
      ctx.beginPath();
      ctx.arc(particleScreenX, particle.y, particle.size * particle.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // Fall detection
    if (player.y > CANVAS_HEIGHT + 100) {
      setLives(prev => prev - 1);
      createParticle(player.x + player.width / 2, CANVAS_HEIGHT - 100, '#ef4444', 20);
      setDamageFlash(1); // Trigger damage flash
      
      if (lives <= 1) {
        setGameState('gameOver');
      } else {
        // 2026-05-08 — Pit-fall respawn now goes to the LAST WAYPOINT
        // (was: nudged back 100px, which dropped the player straight back
        // into the same pit on every life). Falls back to level start
        // if no waypoint reached yet — same behavior as respawnFromWaypoint().
        if (checkpoint) {
          gameRefs.current.player.x = checkpoint.x;
          gameRefs.current.player.y = checkpoint.y - 50;
          gameRefs.current.camera.x = Math.max(0, checkpoint.x - CANVAS_WIDTH / 2);
        } else {
          gameRefs.current.player.x = 150;
          gameRefs.current.player.y = CANVAS_HEIGHT - 150;
          gameRefs.current.camera.x = 0;
        }
        gameRefs.current.player.vx = 0;
        gameRefs.current.player.vy = 0;
        gameRefs.current.player.invulnerable = true;
        setIsInvulnerable(true);
        setTimeout(() => {
          gameRefs.current.player.invulnerable = false;
          setIsInvulnerable(false);
        }, 2000);
        
        // Adjust camera
        gameRefs.current.camera.x = Math.max(0, gameRefs.current.player.x - CANVAS_WIDTH / 2);
      }
    }

  }, [gameState, levelData, lives, showMenu, checkpoint]);

  useEffect(() => {
    const gameLoop = (currentTime) => {
      updateGame(currentTime);
      animationRef.current = requestAnimationFrame(gameLoop);
    };

    if (gameState === 'playing') {
      animationRef.current = requestAnimationFrame(gameLoop);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [updateGame, gameState]);

  const resetGame = () => {
    setLevel(1);
    setScore(0);
    setCoins(0);
    setLives(3);
    setTheme('');
    setLevelData(null);
    setShowMenu(false);
    setCheckpoint(null);
    setLevelProgress(0);
    setPowerUp(null);
    setPowerUpTimer(0);
    setWaypointMessage('');
    setWaypointMessageTimer(0);
    setDamageFlash(0);
    setHurtMessage('');
    setHurtMessageTimer(0);
    setIsInvulnerable(false);
    setGameState('menu');
    gameRefs.current = {
      player: { x: 150, y: CANVAS_HEIGHT - 150, vx: 0, vy: 0, width: PLAYER_WIDTH, height: PLAYER_HEIGHT, grounded: false, jumping: false, running: false, facing: 'right', invulnerable: false, animFrame: 0, speedBoost: 1, hasShield: false, doubleJumpUsed: false },
      camera: { x: 0, y: 0 },
      particles: [],
      collectedCoins: new Set(),
      defeatedEnemies: new Set(),
      passedWaypoints: new Set(),
      brokenBoxes: new Set(),
      openedChests: new Set(),
      keys: {},
      platformStates: new Map(),
      enemyStates: new Map(),
      time: 0,
      lastFrameTime: 0,
      levelLength: 0,
      doorReached: false
    };
  };

  const nextLevel = () => {
    const currentTheme = theme;
    const newLevel = level + 1;
    
    const newProgress = { ...progress };
    newProgress[currentTheme] = Math.max(newProgress[currentTheme] || 0, level);
    
    if (level >= 5) {
      const themeIndex = themes.findIndex(t => t.name === currentTheme);
      if (themeIndex >= 0 && themeIndex < themes.length - 1) {
        const nextThemeName = themes[themeIndex + 1].name;
        if (!newProgress[nextThemeName]) {
          newProgress[nextThemeName] = 0;
        }
      }
      setLevel(1);
      setTheme('');
      setGameState('themeSelect');
    } else {
      setLevel(newLevel);
      generateLevel(newLevel, currentTheme);
    }
    
    setProgress(newProgress);
    localStorage.setItem('horizonRunnerProgress', JSON.stringify(newProgress));
    
    setCheckpoint(null);
    setLevelProgress(0);
    setPowerUp(null);
    setPowerUpTimer(0);
    setWaypointMessage('');
    setWaypointMessageTimer(0);
    gameRefs.current.collectedCoins.clear();
    gameRefs.current.defeatedEnemies.clear();
    gameRefs.current.passedWaypoints.clear();
    gameRefs.current.brokenBoxes.clear();
    gameRefs.current.openedChests.clear();
    gameRefs.current.platformStates.clear();
    gameRefs.current.enemyStates.clear();
    gameRefs.current.particles = [];
    gameRefs.current.player.speedBoost = 1;
    gameRefs.current.player.hasShield = false;
  };

  const restartLevel = () => {
    setLives(3);
    setCheckpoint(null);
    setLevelProgress(0);
    setPowerUp(null);
    setPowerUpTimer(0);
    setWaypointMessage('');
    setWaypointMessageTimer(0);
    setIsInvulnerable(false);
    gameRefs.current.collectedCoins.clear();
    gameRefs.current.defeatedEnemies.clear();
    gameRefs.current.passedWaypoints.clear();
    gameRefs.current.brokenBoxes.clear();
    gameRefs.current.openedChests.clear();
    gameRefs.current.platformStates.clear();
    gameRefs.current.enemyStates.clear();
    gameRefs.current.particles = [];
    gameRefs.current.player.x = 150;
    gameRefs.current.player.y = CANVAS_HEIGHT - 150;  // On ground
    gameRefs.current.player.vx = 0;
    gameRefs.current.player.vy = 0;
    gameRefs.current.player.speedBoost = 1;
    gameRefs.current.player.hasShield = false;
    gameRefs.current.camera.x = 0;
    gameRefs.current.doorReached = false;
    setGameState('playing');
  };

  // 2026-05-11 — Background music for Horizon Runner (distinct from Vector
  // Storm's synthwave). Loops while menu/map/playing; muted on game-over
  // and level-complete screens. Volume kept moderate (0.35) so SFX still
  // read above it. Autoplay requires user gesture in modern browsers —
  // we start it on the first menu click (handled implicitly by the user
  // pressing Start Adventure / clicking a node which sets gameState).
  const bgmRef = useRef(null);
  useEffect(() => {
    const a = bgmRef.current;
    if (!a) return;
    const wantsMusic = gameState === 'menu' || gameState === 'themeSelect' || gameState === 'playing';
    if (wantsMusic) {
      a.volume = 0.35;
      a.play().catch(() => { /* autoplay blocked until first user gesture — that's fine */ });
    } else {
      a.pause();
    }
  }, [gameState]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-purple-900 text-white p-4 relative overflow-hidden">
      <audio ref={bgmRef} src="music.mp3" loop preload="auto" />
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-20px) rotate(180deg); }
        }
      `}</style>

      {gameState === 'menu' && (
        // 2026-05-11 — Menu compacted so it fits the embedded iframe's
        // ~530-px height in the portal grid column. Was: text-7xl title,
        // text-2xl subtitle, gap-8/my-8/p-6 spacing — overflowed and
        // forced a scrollbar. Now uses smaller text + tighter spacing
        // while keeping the same layout intent.
        <div className="text-center space-y-3 animate-fade-in z-10 py-2">
          <div className="relative">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              Horizon Runner
            </h1>
            <p className="text-base text-gray-300">Race to the door in each realm!</p>
          </div>

          <div className="flex justify-center gap-6">
            <div className="text-2xl" style={{ animation: 'float 3s ease-in-out infinite' }}>🏃‍♂️</div>
            <div className="text-2xl" style={{ animation: 'float 3s ease-in-out infinite 0.5s' }}>💎</div>
            <div className="text-2xl" style={{ animation: 'float 3s ease-in-out infinite 1s' }}>🚪</div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => setGameState('themeSelect')}
              className="px-8 py-3 bg-gradient-to-r from-green-500 to-blue-600 rounded-xl font-bold text-lg hover:scale-105 transition-all duration-300 shadow-xl hover:shadow-green-500/50 flex items-center gap-2 mx-auto"
            >
              <Play className="w-5 h-5" />
              Start Adventure
            </button>

            <button
              onClick={() => {
                if (confirm('Are you sure you want to reset all progress? This cannot be undone.')) {
                  localStorage.removeItem('horizonRunnerProgress');
                  setProgress({ 'Mystic Plains': 0 });
                }
              }}
              className="px-5 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg font-bold text-xs transition-all mx-auto"
            >
              Reset All Progress
            </button>
          </div>

          <div className="text-xs text-gray-400 space-y-0.5 bg-black/30 p-3 rounded-lg backdrop-blur max-w-md mx-auto">
            <p className="font-semibold text-cyan-400 text-sm mb-1">How to Play:</p>
            <p>⬅️➡️ Arrow Keys or A/D - Run · ⬆️ Up/W/Space - Jump</p>
            <p>✨ Jump again in air for double jump · 🚩 Waypoints save progress</p>
            <p>📦 Jump on boxes for coins · 💎 Chests for power-ups · 🚪 Reach the door</p>
          </div>
        </div>
      )}

      {gameState === 'themeSelect' && (
        // 2026-05-11 — DKC/Mario-style overworld map. Replaces the grid
        // picker with the generated map.png as background + 10 realm
        // nodes positioned over the painted locations + the explorer
        // avatar (red hat, yellow face) standing at the player's
        // current realm. Node positions are hand-eyeballed against the
        // xAI-generated map; they assume the map is rendered at its
        // 16:9 aspect so % coords stay consistent at any size.
        (() => {
          // Per-theme position on the map (percent of map width/height).
          // Order matches the `themes` array above.
          const NODE_POS = [
            { x: 10, y: 84 },  // Mystic Plains    — bottom-left meadow
            { x: 22, y: 86 },  // Crystal Caverns  — blue crystals lower-left
            { x: 18, y: 22 },  // Cloudtop Highway — clouds top-left
            { x: 35, y: 56 },  // Lava Bridge      — red lava arch center
            { x: 48, y: 28 },  // Frozen Tundra    — snowy center-top
            { x: 52, y: 64 },  // Jungle Path      — green canopy center
            { x: 72, y: 52 },  // Neon City        — pink cyber buildings right
            { x: 85, y: 78 },  // Desert Ruins     — sandy pillars bottom-right
            { x: 75, y: 22 },  // Moonlit Road     — purple mountains top
            { x: 92, y: 24 },  // Golden Palace    — gold castle top-right
          ];

          // Find current realm: first unlocked-but-incomplete theme, else last unlocked, else 0.
          const incompleteIdx = themes.findIndex(t => progress.hasOwnProperty(t.name) && (progress[t.name] || 0) < 5);
          const lastUnlockedIdx = (() => {
            for (let i = themes.length - 1; i >= 0; i--) if (progress.hasOwnProperty(themes[i].name)) return i;
            return 0;
          })();
          const currentIdx = incompleteIdx >= 0 ? incompleteIdx : lastUnlockedIdx;
          const currentPos = NODE_POS[currentIdx] || NODE_POS[0];

          return (
            <div className="relative w-full h-full flex flex-col items-center justify-center p-2">
              {/* Map frame: 16:9, max-w fits iframe, holds bg image + nodes + avatar */}
              <div
                className="relative w-full max-w-4xl rounded-xl overflow-hidden shadow-2xl border-2 border-amber-700/40"
                style={{ aspectRatio: '16 / 9', backgroundImage: 'url(map.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}
              >
                {/* Realm nodes */}
                {themes.map((themeItem, idx) => {
                  const isUnlocked = progress.hasOwnProperty(themeItem.name);
                  const completedLevels = progress[themeItem.name] || 0;
                  const isComplete = completedLevels >= 5;
                  const pos = NODE_POS[idx];
                  if (!pos) return null;
                  return (
                    <button
                      key={themeItem.name}
                      onClick={() => {
                        if (isUnlocked) {
                          const nextLevel = Math.min(completedLevels + 1, 5);
                          setTheme(themeItem.name);
                          setLevel(nextLevel);
                          generateLevel(nextLevel, themeItem.name);
                        }
                      }}
                      disabled={!isUnlocked}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-full border-2 transition-all ${
                        isUnlocked ? 'hover:scale-125 cursor-pointer shadow-lg' : 'cursor-not-allowed opacity-60'
                      } ${idx === currentIdx ? 'animate-pulse' : ''}`}
                      style={{
                        left: `${pos.x}%`,
                        top: `${pos.y}%`,
                        background: isUnlocked ? themeItem.color : '#1f2937',
                        borderColor: isComplete ? '#fbbf24' : isUnlocked ? '#ffffff' : '#6b7280',
                        boxShadow: isUnlocked ? `0 0 16px ${themeItem.color}aa` : 'none',
                      }}
                      title={themeItem.name + (isUnlocked ? ` — Stage ${completedLevels + 1}/5` : ' — Locked')}
                    >
                      {isComplete ? (
                        <span className="text-yellow-200 text-base">★</span>
                      ) : isUnlocked ? (
                        <span className="text-slate-900 text-xs font-black">{idx + 1}</span>
                      ) : (
                        <span className="text-gray-400 text-xs">🔒</span>
                      )}
                    </button>
                  );
                })}

                {/* Player avatar — explorer with red hat + gold buckle, matches in-game character.
                    Positioned at currentIdx; transition for smooth walk-along-path feel. */}
                <div
                  className="absolute -translate-x-1/2 pointer-events-none transition-all duration-700 ease-out"
                  style={{
                    left: `${currentPos.x}%`,
                    top: `calc(${currentPos.y}% - 32px)`,
                    filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.6))',
                  }}
                >
                  <svg width="36" height="44" viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg">
                    {/* Hat brim */}
                    <rect x="3"  y="6"  width="30" height="2"  fill="#dc2626"/>
                    {/* Hat body */}
                    <rect x="5"  y="8"  width="26" height="9"  fill="#dc2626"/>
                    {/* Hat band */}
                    <rect x="5"  y="14" width="26" height="3"  fill="#991b1b"/>
                    {/* Hat top */}
                    <rect x="7"  y="3"  width="22" height="3"  fill="#dc2626"/>
                    {/* Gold buckle */}
                    <rect x="15" y="10" width="6"  height="4"  fill="#fbbf24" stroke="#d97706" strokeWidth="0.5"/>
                    {/* Face (skin) */}
                    <circle cx="18" cy="22" r="8"  fill="#fde68a" stroke="#d97706" strokeWidth="0.5"/>
                    {/* Hair tufts */}
                    <path d="M10 19 Q9 16 11 14 L13 20 Z" fill="#92400e"/>
                    <path d="M26 19 Q27 16 25 14 L23 20 Z" fill="#92400e"/>
                    {/* Eyes */}
                    <ellipse cx="15" cy="22" rx="1.5" ry="2" fill="#1e3a8a"/>
                    <ellipse cx="21" cy="22" rx="1.5" ry="2" fill="#1e3a8a"/>
                    {/* Smile */}
                    <path d="M14 26 Q18 29 22 26" stroke="#b45309" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
                    {/* Body */}
                    <rect x="13" y="29" width="10" height="9" rx="2" fill="#2563eb"/>
                    {/* Hands */}
                    <circle cx="11" cy="33" r="2.5" fill="#fde68a"/>
                    <circle cx="25" cy="33" r="2.5" fill="#fde68a"/>
                    {/* Legs */}
                    <rect x="14" y="37" width="3" height="5" fill="#1e40af"/>
                    <rect x="19" y="37" width="3" height="5" fill="#1e40af"/>
                  </svg>
                </div>
              </div>

              {/* Footer: current realm label + Back button */}
              <div className="mt-3 flex items-center justify-between w-full max-w-4xl px-2 text-xs">
                <button
                  onClick={resetGame}
                  className="px-3 py-1 bg-slate-700/80 hover:bg-slate-600 rounded-lg font-bold transition-all"
                >
                  ← Menu
                </button>
                <div className="text-cyan-300 font-semibold">
                  {themes[currentIdx]?.name} — Stage {Math.min((progress[themes[currentIdx]?.name] || 0) + 1, 5)}/5
                </div>
                <div className="text-gray-500">Click a glowing realm to play</div>
              </div>
            </div>
          );
        })()
      )}

      {isGenerating && (
        <div className="text-center space-y-6 z-10">
          <Sparkles className="w-20 h-20 mx-auto animate-spin text-cyan-400" />
          <h2 className="text-4xl font-bold">Generating Level...</h2>
        </div>
      )}

      {gameState === 'playing' && (
        <div className="fixed inset-0">
          {/* UI Overlay */}
          <div className="absolute top-4 left-4 z-20 bg-black/80 backdrop-blur px-6 py-3 rounded-xl border-2 border-cyan-500">
            <div className="font-bold text-xl">{levelData?.levelName}</div>
            <div className="text-sm text-gray-300">Waypoints save progress for Game Over</div>
            {checkpoint && (
              <div className="text-xs text-green-400 mt-1">Waypoint {checkpoint.id} saved</div>
            )}
          </div>
          
          <div className="absolute top-4 right-4 z-20 bg-black/80 backdrop-blur px-6 py-3 rounded-xl border-2 border-purple-500 space-y-2">
            <div className="flex items-center gap-3">
              <Coins className="w-5 h-5 text-yellow-400" />
              <span className="font-bold">{coins}</span>
            </div>
            <div className="flex items-center gap-3">
              <Star className="w-5 h-5 text-cyan-400" />
              <span className="font-bold">{score}</span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 3 }, (_, i) => (
                <Heart 
                  key={i} 
                  className="w-6 h-6" 
                  fill={i < lives ? '#ef4444' : 'none'}
                  color={i < lives ? '#ef4444' : '#4b5563'}
                />
              ))}
            </div>
            {powerUp && (
              <div className="pt-2 border-t border-purple-600">
                <div className="flex items-center gap-2">
                  {powerUp === 'speed' ? (
                    <>
                      <Zap className="w-5 h-5 text-green-400 animate-pulse" />
                      <span className="text-green-400 text-sm font-bold">SPEED</span>
                    </>
                  ) : (
                    <>
                      <div className="w-5 h-5 rounded-full border-2 border-blue-400 animate-pulse" />
                      <span className="text-blue-400 text-sm font-bold">SHIELD</span>
                    </>
                  )}
                </div>
              </div>
            )}
            {isInvulnerable && (
              <div className="pt-2">
                <span className="text-white text-xs animate-pulse">INVULNERABLE</span>
              </div>
            )}
          </div>
          
          {/* Damage Flash Overlay */}
          {damageFlash > 0 && (
            <div 
              className="absolute inset-0 pointer-events-none z-40"
              style={{
                backgroundColor: `rgba(239, 68, 68, ${damageFlash * 0.4})`,
                mixBlendMode: 'screen'
              }}
            />
          )}
          
          {/* Progress Bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-black/60 backdrop-blur p-2 rounded-full w-80">
            <div className="bg-gray-700 rounded-full h-3 relative overflow-hidden">
              <div 
                className="bg-gradient-to-r from-green-400 to-blue-500 h-full transition-all duration-300 rounded-full"
                style={{ width: `${levelProgress}%` }}
              />
              <DoorOpen className="absolute right-2 -top-1 w-5 h-5 text-purple-400" />
            </div>
          </div>
          
          {/* Pause Menu */}
          {showMenu && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-10 rounded-2xl border-4 border-cyan-500 space-y-6">
                <h2 className="text-4xl font-bold text-center text-cyan-400">PAUSED</h2>
                <button
                  onClick={() => setShowMenu(false)}
                  className="w-full px-8 py-4 bg-green-600 hover:bg-green-500 rounded-xl font-bold text-xl transition-all"
                >
                  Resume
                </button>
                <button
                  onClick={resetGame}
                  className="w-full px-8 py-4 bg-slate-700 hover:bg-slate-600 rounded-xl font-bold text-xl transition-all"
                >
                  Main Menu
                </button>
              </div>
            </div>
          )}
          
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="absolute inset-0"
          />
        </div>
      )}

      {gameState === 'levelComplete' && (
        <div className="text-center space-y-8 z-10">
          <DoorOpen className="w-24 h-24 mx-auto text-green-400 animate-bounce" />
          <h2 className="text-5xl font-bold bg-gradient-to-r from-green-400 to-blue-500 bg-clip-text text-transparent">
            Stage Complete!
          </h2>
          <div className="space-y-3 bg-black/40 p-8 rounded-2xl backdrop-blur">
            <p className="text-2xl">Score: <span className="text-cyan-400 font-bold">{score}</span></p>
            <p className="text-2xl">Coins: <span className="text-yellow-400 font-bold">{coins}</span></p>
          </div>
          <button
            onClick={nextLevel}
            className="px-10 py-5 bg-gradient-to-r from-green-500 to-cyan-600 rounded-xl font-bold text-xl hover:scale-110 transition-all"
          >
            Next Stage
          </button>
        </div>
      )}

      {gameState === 'gameOver' && (
        <div className="text-center space-y-8 z-10">
          <div className="text-6xl">💔</div>
          <h2 className="text-5xl font-bold text-red-400">Game Over</h2>
          <div className="space-y-3 bg-black/40 p-8 rounded-2xl backdrop-blur">
            <p className="text-xl">Final Score: <span className="text-cyan-400 font-bold">{score}</span></p>
            <p className="text-xl">Coins Collected: <span className="text-yellow-400 font-bold">{coins}</span></p>
            {checkpoint && (
              <p className="text-lg text-green-400">Last Waypoint Reached: #{checkpoint.id}</p>
            )}
          </div>
          <div className="space-y-4">
            {checkpoint && (
              <button
                onClick={() => {
                  respawnFromWaypoint();
                  setGameState('playing');
                }}
                className="block w-64 mx-auto px-10 py-4 bg-green-600 hover:bg-green-500 rounded-xl font-bold text-xl transition-all"
              >
                Continue from Waypoint
              </button>
            )}
            <button
              onClick={restartLevel}
              className="block w-64 mx-auto px-10 py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-xl transition-all"
            >
              Restart Level
            </button>
            <button
              onClick={resetGame}
              className="block w-64 mx-auto px-8 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-bold transition-all"
            >
              Main Menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HorizonRunner;