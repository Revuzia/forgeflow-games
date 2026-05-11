import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, Heart, Star, Zap, TreePine, Snowflake, Droplets, Flame, Cloud, Gem, Mountain, Palette, Moon, Sun, ArrowUp, Rocket } from 'lucide-react';

const GRAVITY = 0.6;
const JUMP_FORCE = -13;
const MOVE_SPEED = 5;
const PLAYER_SIZE = 32;
// 2026-05-08 — FIXED virtual game world (16:9). Internal canvas resolution
// is pinned at 1280x720 forever; the wrapper index.html scales the *display*
// size to fit any viewport.
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

const t = (key) => {
  const translations = {
    gameTitle: "Sky Battle",
    gameSubtitle: "Ascend through infinite battle zones!",
    startAdventure: "Start Journey",
    controlsArrow: "Arrow Keys or WASD to move",
    controlsJump: "Up/W/Space to jump",
    controlsDefeat: "Defeat enemies by jumping on them",
    chooseTheme: "🛣️ Begin Your Journey",
    levelDifficulty: "Level",
    customTheme: "Custom Theme",
    enterCustomTheme: "Enter Your Custom Theme",
    customPlaceholder: "e.g. Volcano, Ice Palace...",
    generateLevel: "Start Climb",
    generatingLevel: "Generating Battle Zone...",
    creatingExperience: "Creating experience",
    buildingChallenges: "Building challenges...",
    levelLabel: "Level",
    scoreLabel: "Score",
    heightLabel: "Height",
    progressHint: "Climb to the summit!",
    levelComplete: "Summit Reached!",
    nextLevel: "Next Challenge",
    gameOver: "Battle Lost",
    retryLevel: "Retry Battle",
    backToMenu: "Back to Map",
    locked: "🔒 LOCKED",
    unlocked: "UNLOCKED",
    complete: "✔ COMPLETE"
  };
  return translations[key] || key;
};

const ClimberGame = () => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const [gameState, setGameState] = useState('menu');
  const [theme, setTheme] = useState('');
  const [customTheme, setCustomTheme] = useState('');
  const [level, setLevel] = useState(1);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [levelData, setLevelData] = useState(null);
  const [height, setHeight] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [progress, setProgress] = useState(() => {
    const saved = localStorage.getItem('skyBattleProgress');
    return saved ? JSON.parse(saved) : { 'Sky Temple': 0 };
  });
  
  const gameRefs = useRef({
    player: {
      x: window.innerWidth / 2 - PLAYER_SIZE / 2,
      y: window.innerHeight - 100,
      vx: 0,
      vy: 0,
      width: PLAYER_SIZE,
      height: PLAYER_SIZE,
      grounded: false,
      jumpCount: 0,
      hasDoubleJump: false,
      invulnerable: false,
      rotation: 0
    },
    camera: { y: 0 },
    particles: [],
    collectedItems: new Set(),
    defeatedEnemies: new Set(),
    keys: {},
    platformStates: new Map(),
    enemyStates: new Map(),
    time: 0,
    highestY: window.innerHeight - 100,
    lastFrameTime: 0
  });

  const themes = [
    { name: 'Sky Temple', icon: Star, color: '#ffd700', bg: '#1a1a3e' },
    { name: 'Crystal Spire', icon: Gem, color: '#06b6d4', bg: '#0a0e27' },
    { name: 'Cloud Castle', icon: Cloud, color: '#e0f2fe', bg: '#0c4a6e' },
    { name: 'Volcano Ascent', icon: Flame, color: '#f97316', bg: '#431407' },
    { name: 'Ice Peak', icon: Snowflake, color: '#bfdbfe', bg: '#172554' },
    { name: 'Jungle Canopy', icon: TreePine, color: '#4ade80', bg: '#14532d' },
    { name: 'Neon Tower', icon: Zap, color: '#ec4899', bg: '#1e1b4b' },
    { name: 'Ancient Ziggurat', icon: Mountain, color: '#d97706', bg: '#451a03' },
    { name: 'Moonlit Spire', icon: Moon, color: '#a78bfa', bg: '#1e1b4b' },
    { name: 'Golden Pagoda', icon: Sun, color: '#fbbf24', bg: '#78350f' }
  ];

  const createFallbackLevel = (themeName, difficulty) => {
    const targetHeight = difficulty * 100;
    const startY = CANVAS_HEIGHT - 50;
    const platforms = [{ x: CANVAS_WIDTH / 2 - 50, y: startY, width: 100, height: 20, type: 'normal' }];
    const platformCount = Math.floor(targetHeight / 8) + 10;
    let lastY = startY;
    
    const themeColors = {
      'Sky Temple': {
        color: '#ffd700',
        bg: '#1a1a3e',
        platform: '#2d2d5e',
        gradient1: '#1a2a4e',
        gradient2: '#0a0f2e',
        particle: '#ffd700',
        enemyColor: '#ffd700',
        bgParticle: '#ffd700'
      },
      'Crystal Spire': {
        color: '#22d3ee',
        bg: '#0a0e27',
        platform: '#0891b2',
        gradient1: '#0a1929',
        gradient2: '#030810',
        particle: '#22d3ee',
        enemyColor: '#22d3ee',
        bgParticle: '#06b6d4'
      },
      'Cloud Castle': {
        color: '#e0f2fe',
        bg: '#0c4a6e',
        platform: '#075985',
        gradient1: '#0c5a8e',
        gradient2: '#082f49',
        particle: '#bae6fd',
        enemyColor: '#bae6fd',
        bgParticle: '#ffffff'
      },
      'Volcano Ascent': {
        color: '#f97316',
        bg: '#431407',
        platform: '#7c2d12',
        gradient1: '#5c1f07',
        gradient2: '#1c0a00',
        particle: '#fb923c',
        enemyColor: '#f97316',
        bgParticle: '#fb923c'
      },
      'Ice Peak': {
        color: '#bfdbfe',
        bg: '#172554',
        platform: '#1e3a8a',
        gradient1: '#1e3a8a',
        gradient2: '#0f172a',
        particle: '#dbeafe',
        enemyColor: '#bfdbfe',
        bgParticle: '#dbeafe'
      },
      'Jungle Canopy': {
        color: '#4ade80',
        bg: '#14532d',
        platform: '#166534',
        gradient1: '#1a5c3a',
        gradient2: '#052e16',
        particle: '#86efac',
        enemyColor: '#4ade80',
        bgParticle: '#86efac'
      },
      'Neon Tower': {
        color: '#ec4899',
        bg: '#1e1b4b',
        platform: '#312e81',
        gradient1: '#2e2b6b',
        gradient2: '#0f0a2e',
        particle: '#f9a8d4',
        enemyColor: '#ec4899',
        bgParticle: '#f9a8d4'
      },
      'Ancient Ziggurat': {
        color: '#d97706',
        bg: '#451a03',
        platform: '#78350f',
        gradient1: '#5c2509',
        gradient2: '#1c0a00',
        particle: '#fbbf24',
        enemyColor: '#d97706',
        bgParticle: '#fbbf24'
      },
      'Moonlit Spire': {
        color: '#a78bfa',
        bg: '#1e1b4b',
        platform: '#312e81',
        gradient1: '#2e2b6b',
        gradient2: '#0f0a2e',
        particle: '#c4b5fd',
        enemyColor: '#a78bfa',
        bgParticle: '#c4b5fd'
      },
      'Golden Pagoda': {
        color: '#fbbf24',
        bg: '#78350f',
        platform: '#92400e',
        gradient1: '#854d0e',
        gradient2: '#451a03',
        particle: '#fde047',
        enemyColor: '#fbbf24',
        bgParticle: '#fde047'
      }
    };
    const themeColor = themeColors[themeName]?.color || '#00d4ff';
    const currentTheme = themeColors[themeName] || themeColors['Sky Temple'];
    
    const seed = Date.now() + themeName.length;
    const random = (min, max) => {
      const x = Math.sin(seed + lastY) * 10000;
      return min + (x - Math.floor(x)) * (max - min);
    };
    
    for (let i = 1; i < platformCount; i++) {
      const verticalGap = 50 + random(0, 1) * 40;
      const y = lastY - verticalGap;
      const horizontalVariation = Math.sin(i * 0.5 + seed) * (CANVAS_WIDTH * 0.25) + Math.cos(i * 0.3 + seed) * (CANVAS_WIDTH * 0.15);
      const x = CANVAS_WIDTH / 2 + horizontalVariation;
      
      const types = ['normal', 'moving', 'bouncy', 'disappearing', 'ice'];
      const typeChance = random(0, 1);
      let type = 'normal';
      
      if (typeChance > 0.85) type = 'moving';
      else if (typeChance > 0.7) type = 'bouncy';
      else if (typeChance > 0.55) type = 'disappearing';
      else if (typeChance > 0.4) type = 'ice';
      
      platforms.push({
        x: Math.max(50, Math.min(CANVAS_WIDTH - 150, x)),
        y: y,
        width: 70 + random(0, 1) * 50,
        height: 18,
        type,
        movementRange: type === 'moving' ? 100 : undefined,
        movementSpeed: type === 'moving' ? 1 + random(0, 1) * 1 : undefined,
        movementDirection: type === 'moving' ? 'horizontal' : undefined,
        movementOffset: type === 'moving' ? random(0, 1) * 100 : 0
      });
      
      lastY = y;
    }

    const enemies = [];
    const enemyCount = 20 + difficulty * 2;
    for (let i = 5; i < platformCount && enemies.length < enemyCount; i += 5) {
      const platform = platforms[i];
      if (!platform) continue;
      const types = ['circle', 'square', 'circle'];
      const type = types[Math.floor(random(0, 1) * types.length)];
      enemies.push({
        x: platform.x + platform.width / 2,
        y: platform.y - 20,
        platformIndex: i,
        type,
        color: currentTheme.enemyColor,
        patrolRange: Math.min(platform.width * 0.8, 80),
        speed: 1.2
      });
    }

    const collectibles = [];
    const collectibleCount = 30 + difficulty * 3;
    for (let i = 0; i < collectibleCount; i++) {
      const canHaveDoubleJump = (difficulty === 4 || difficulty === 5);
      const itemRandom = Math.sin(seed + i * 1000) * 10000;
      const randomValue = itemRandom - Math.floor(itemRandom);
      const valueRandom = Math.sin(seed + i * 2000) * 10000;
      const valueRandomValue = valueRandom - Math.floor(valueRandom);
      
      collectibles.push({
        x: 100 + randomValue * (CANVAS_WIDTH - 200),
        y: (CANVAS_HEIGHT - 150) - (i * 200),
        type: (canHaveDoubleJump && randomValue > 0.85) ? 'powerup' : 'gem',
        value: valueRandomValue > 0.9 ? 50 : 10
      });
    }

    const obstacles = [];
    const obstacleCount = 15 + Math.floor(difficulty / 2);
    for (let i = 7; i < platformCount && obstacles.length < obstacleCount; i += 6) {
      const platform = platforms[i];
      if (!platform || platform.type === 'moving') continue;
      obstacles.push({
        x: platform.x + random(0, 1) * (platform.width - 40),
        y: platform.y - 25,
        platformIndex: i,
        type: 'spike',
        width: 40,
        height: 25
      });
    }
    
    const floatingObstacles = Math.floor(obstacleCount / 2);
    for (let i = 0; i < floatingObstacles; i++) {
      obstacles.push({
        x: 150 + random(0, 1) * (CANVAS_WIDTH - 300),
        y: 500 - (i * 600),
        type: 'fireball',
        width: 30,
        height: 30,
        floating: true
      });
    }

    return {
      platforms,
      enemies,
      collectibles,
      obstacles,
      theme: {
        backgroundColor: currentTheme.bg,
        platformColor: currentTheme.platform,
        accentColor: currentTheme.color,
        gradient1: currentTheme.gradient1,
        gradient2: currentTheme.gradient2,
        particleColor: currentTheme.particle,
        enemyColor: currentTheme.enemyColor,
        bgParticleColor: currentTheme.bgParticle
      },
      levelName: themeName + ' - Level ' + difficulty,
      levelDescription: 'Climb ' + targetHeight + 'm to the summit',
      goalHeight: startY - targetHeight * 10,
      targetHeight: targetHeight
    };
  };

  const generateLevel = async (levelToGenerate = null, themeToUse = null) => {
    setIsGenerating(true);
    const actualLevel = levelToGenerate !== null ? levelToGenerate : level;
    const currentTheme = themeToUse || (theme === 'custom' ? customTheme : theme);
    await new Promise(resolve => setTimeout(resolve, 100));
    const fallbackData = createFallbackLevel(currentTheme, actualLevel);
    setLevelData(fallbackData);
    setGameState('playing');
    setIsGenerating(false);
  };

  const createParticle = (x, y, color) => {
    gameRefs.current.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 6,
      vy: Math.random() * -5 - 2,
      life: 1,
      size: Math.random() * 4 + 2,
      color: color || levelData?.theme.accentColor || '#ffffff'
    });
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

    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, levelData.theme.gradient1);
    gradient.addColorStop(1, levelData.theme.gradient2);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.save();
    ctx.globalAlpha = 0.15;
    const parallaxOffset = camera.y * 0.3;
    for (let i = 0; i < 30; i++) {
      const bgX = (i * 50 + game.time * 0.2) % (CANVAS_WIDTH + 100) - 50;
      const bgY = (Math.sin(i + game.time * 0.01) * 100 + parallaxOffset + i * 100) % (CANVAS_HEIGHT + 100);
      ctx.fillStyle = levelData.theme.bgParticleColor || levelData.theme.accentColor;
      ctx.beginPath();
      ctx.arc(bgX, bgY, 15 + Math.sin(i) * 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (keys['ArrowLeft'] || keys['a']) {
      player.vx = -MOVE_SPEED;
      player.rotation = -0.1;
    } else if (keys['ArrowRight'] || keys['d']) {
      player.vx = MOVE_SPEED;
      player.rotation = 0.1;
    } else {
      player.vx *= 0.85;
      player.rotation *= 0.9;
    }

    if ((keys['ArrowUp'] || keys['w'] || keys[' ']) && (player.grounded || (player.hasDoubleJump && player.jumpCount < 2))) {
      if (!game.jumpPressed) {
        player.vy = JUMP_FORCE;
        player.jumpCount++;
        game.jumpPressed = true;
        createParticle(player.x + player.width / 2, player.y + player.height, levelData.theme.accentColor);
      }
    } else {
      game.jumpPressed = false;
    }

    player.vy += GRAVITY * deltaTime;
    player.vy = Math.min(player.vy, 20);
    player.x += player.vx * deltaTime;
    player.y += player.vy * deltaTime;

    if (player.x < 0) player.x = 0;
    if (player.x + player.width > CANVAS_WIDTH) player.x = CANVAS_WIDTH - player.width;

    if (player.y < game.highestY) {
      game.highestY = player.y;
    }
    setHeight(Math.floor(Math.max(0, ((CANVAS_HEIGHT - 50) - game.highestY) / 10)));

    const targetCameraY = player.y - CANVAS_HEIGHT * 0.6;
    camera.y += (targetCameraY - camera.y) * 0.1;

    player.grounded = false;
    let standingPlatform = null;
    
    levelData.platforms.forEach((platform, index) => {
      if (platform.type === 'gone') return;
      
      let platformX = platform.x;
      const platformY = platform.y;
      let platformVelocity = 0;

      if (platform.type === 'moving' && platform.movementRange) {
        if (!game.platformStates.has(index)) {
          game.platformStates.set(index, { 
            offset: platform.movementOffset || 0, 
            direction: Math.random() > 0.5 ? 1 : -1
          });
        }
        const state = game.platformStates.get(index);
        const oldOffset = state.offset;
        state.offset += (platform.movementSpeed || 1.5) * state.direction * deltaTime;
        if (Math.abs(state.offset) > platform.movementRange) {
          state.direction *= -1;
        }
        platformX += state.offset;
        platformVelocity = (state.offset - oldOffset) / deltaTime;
      }

      if (player.x < platformX + platform.width &&
          player.x + player.width > platformX &&
          player.y < platformY + platform.height &&
          player.y + player.height > platformY) {
        
        if (player.vy > 0 && player.y < platformY) {
          player.y = platformY - player.height;
          player.vy = 0;
          player.grounded = true;
          player.jumpCount = 0;
          
          standingPlatform = { index, velocity: platformVelocity };

          if (platform.type === 'ice') {
            player.vx *= 1.05;
          } else if (platform.type === 'bouncy') {
            player.vy = JUMP_FORCE * 1.6;
            for (let i = 0; i < 5; i++) createParticle(platformX + platform.width / 2, platformY, '#ffeb3b');
          } else if (platform.type === 'disappearing') {
            const stateKey = 'disappear-' + index;
            if (!game.platformStates.has(stateKey)) {
              game.platformStates.set(stateKey, { timer: 0 });
            }
            const state = game.platformStates.get(stateKey);
            state.timer += deltaTime;
            if (state.timer > 20) {
              platform.opacity = Math.max(0, 1 - (state.timer - 20) / 30);
              if (state.timer > 50) {
                platform.type = 'gone';
              }
            }
          }
        }
      }

      if (platform.type === 'gone') return;

      const screenY = platformY - camera.y;
      if (screenY > -50 && screenY < CANVAS_HEIGHT + 50) {
        ctx.save();
        ctx.globalAlpha = platform.opacity || 1;
        
        let color = levelData.theme.platformColor;
        if (platform.type === 'ice') {
          const iceGradient = ctx.createLinearGradient(platformX, screenY, platformX, screenY + platform.height);
          iceGradient.addColorStop(0, '#e0ffff');
          iceGradient.addColorStop(1, '#b0e0e6');
          color = iceGradient;
        } else if (platform.type === 'bouncy') {
          color = levelData.theme.accentColor;
        }
        
        ctx.fillStyle = color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = levelData.theme.accentColor;
        ctx.fillRect(platformX, screenY, platform.width, platform.height);
        
        if (platform.type === 'moving') {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(platformX + platform.width / 2, screenY + platform.height / 2, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        
        ctx.restore();
      }
    });

    if (standingPlatform && standingPlatform.velocity !== 0) {
      player.x += standingPlatform.velocity * deltaTime;
    }

    levelData.enemies.forEach((enemy, index) => {
      if (game.defeatedEnemies.has(index)) return;
      
      const state = game.enemyStates.get(index) || { 
        x: enemy.x, 
        y: enemy.y, 
        vx: 1, 
        vy: 0, 
        time: 0,
        bouncePhase: 0,
        hopTimer: 0,
        isHopping: false
      };
      state.time += deltaTime;
      
      let platformY = enemy.y;
      let platformX = enemy.x;
      if (enemy.platformIndex !== undefined && levelData.platforms[enemy.platformIndex]) {
        const platform = levelData.platforms[enemy.platformIndex];
        let platX = platform.x;
        
        if (platform.type === 'moving') {
          const platformState = game.platformStates.get(enemy.platformIndex);
          if (platformState) {
            platX += platformState.offset;
          }
        }
        platformY = platform.y - 20;
        platformX = platX + platform.width / 2;
        
        enemy.x = platformX;
      }
      
      switch (enemy.type) {
        case 'circle':
          state.hopTimer += deltaTime;
          if (state.hopTimer > 60) {
            state.isHopping = true;
            state.hopTimer = 0;
          }
          
          if (state.isHopping) {
            state.bouncePhase += 0.25 * deltaTime;
            if (state.bouncePhase > Math.PI * 2) {
              state.bouncePhase = 0;
              state.isHopping = false;
            }
          }
          
          state.x = enemy.x;
          state.y = platformY - Math.abs(Math.sin(state.bouncePhase)) * 25;
          break;
        case 'square':
          state.hopTimer += deltaTime;
          
          if (state.hopTimer > 40) {
            state.isHopping = true;
            state.hopTimer = 0;
          }
          
          if (state.isHopping) {
            state.bouncePhase += 0.2 * deltaTime;
            if (!state.offsetX) state.offsetX = 0;
            state.offsetX += enemy.speed * state.vx * 2 * deltaTime;
            
            if (state.bouncePhase > Math.PI) {
              state.bouncePhase = 0;
              state.isHopping = false;
            }
          }
          
          if (enemy.platformIndex !== undefined && levelData.platforms[enemy.platformIndex]) {
            const platform = levelData.platforms[enemy.platformIndex];
            
            if (!state.offsetX) state.offsetX = 0;
            
            const maxOffset = platform.width / 2 - 20;
            if (state.offsetX < -maxOffset) {
              state.offsetX = -maxOffset;
              state.vx = 1;
            }
            if (state.offsetX > maxOffset) {
              state.offsetX = maxOffset;
              state.vx = -1;
            }
          }
          
          state.x = platformX + (state.offsetX || 0);
          state.y = platformY - Math.abs(Math.sin(state.bouncePhase)) * 20;
          break;
      }
      
      game.enemyStates.set(index, state);
      
      if (!player.invulnerable &&
          Math.abs(player.x + player.width / 2 - state.x) < 30 &&
          Math.abs(player.y + player.height / 2 - state.y) < 30) {
        
        if (player.vy > 0 && player.y < state.y - 10) {
          game.defeatedEnemies.add(index);
          setScore(prev => prev + 30);
          player.vy = JUMP_FORCE * 0.7;
          for (let i = 0; i < 10; i++) {
            createParticle(state.x, state.y, levelData.theme.accentColor);
          }
        } else {
          setLives(prev => prev - 1);
          player.invulnerable = true;
          setTimeout(() => { player.invulnerable = false; }, 2000);
          for (let i = 0; i < 15; i++) {
            createParticle(player.x + player.width / 2, player.y + player.height / 2, '#ff5252');
          }
          if (lives <= 1) setGameState('gameOver');
        }
      }
      
      const screenY = state.y - camera.y;
      if (screenY > -50 && screenY < CANVAS_HEIGHT + 50) {
        ctx.save();
        
        const squish = state.isHopping ? 1 - Math.abs(Math.sin(state.bouncePhase)) * 0.4 : 1;
        const stretch = state.isHopping ? 1 + Math.abs(Math.sin(state.bouncePhase)) * 0.3 : 1;
        
        if (enemy.type === 'circle') {
          ctx.translate(state.x, screenY);
          ctx.scale(stretch, squish);
          
          ctx.shadowBlur = 20;
          ctx.shadowColor = enemy.color || '#ff5252';
          
          const gradient = ctx.createRadialGradient(0, -3, 0, 0, -3, 18);
          gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
          gradient.addColorStop(1, enemy.color || '#ff5252');
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(0, 0, 16, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.beginPath();
          ctx.arc(-5, -6, 5, 0, Math.PI * 2);
          ctx.fill();
          
          const blink = state.time % 120 > 115 ? 0.3 : 1;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.ellipse(-5, -2, 4, 4 * blink, 0, 0, Math.PI * 2);
          ctx.ellipse(5, -2, 4, 4 * blink, 0, 0, Math.PI * 2);
          ctx.fill();
          
          const lookDir = state.vx * 0.5;
          ctx.fillStyle = '#000000';
          ctx.beginPath();
          ctx.arc(-5 + lookDir, -2, 2, 0, Math.PI * 2);
          ctx.arc(5 + lookDir, -2, 2, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-9, -9);
          ctx.lineTo(-3, -7);
          ctx.moveTo(9, -9);
          ctx.lineTo(3, -7);
          ctx.stroke();
          
          ctx.beginPath();
          ctx.arc(0, 4, 4, 0.2, Math.PI - 0.2);
          ctx.stroke();
          
        } else if (enemy.type === 'square') {
          ctx.translate(state.x, screenY);
          ctx.scale(stretch, squish);
          
          ctx.shadowBlur = 20;
          ctx.shadowColor = enemy.color || '#ff6b6b';
          
          const gradient = ctx.createLinearGradient(-15, -15, 15, 15);
          gradient.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
          gradient.addColorStop(1, enemy.color || '#ff6b6b');
          ctx.fillStyle = gradient;
          ctx.fillRect(-15, -15, 30, 30);
          
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.fillRect(-13, -13, 10, 10);
          
          const blink = state.time % 100 > 95 ? 0.3 : 1;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.ellipse(-6, -5, 4, 4 * blink, 0, 0, Math.PI * 2);
          ctx.ellipse(6, -5, 4, 4 * blink, 0, 0, Math.PI * 2);
          ctx.fill();
          
          const lookDir = state.vx * 0.5;
          ctx.fillStyle = '#000000';
          ctx.beginPath();
          ctx.arc(-6 + lookDir, -5, 2, 0, Math.PI * 2);
          ctx.arc(6 + lookDir, -5, 2, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = '#000000';
          ctx.fillRect(-7, 5, 14, 4);
          
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-5, 5, 3, 2);
          ctx.fillRect(2, 5, 3, 2);
        }
        
        ctx.restore();
      }
    });

    levelData.collectibles.forEach((item, index) => {
      if (game.collectedItems.has(index)) return;

      const dist = Math.sqrt(
        Math.pow(player.x + player.width / 2 - item.x, 2) +
        Math.pow(player.y + player.height / 2 - item.y, 2)
      );

      if (dist < 35) {
        game.collectedItems.add(index);
        setScore(prev => prev + (item.value || 10));
        
        if (item.type === 'powerup') {
          player.hasDoubleJump = true;
          for (let i = 0; i < 20; i++) {
            createParticle(item.x, item.y, '#4caf50');
          }
        } else {
          for (let i = 0; i < 10; i++) {
            createParticle(item.x, item.y, levelData.theme.accentColor);
          }
        }
      }

      const screenY = item.y - camera.y;
      if (!game.collectedItems.has(index) && screenY > -50 && screenY < CANVAS_HEIGHT + 50) {
        ctx.save();
        
        const bounce = Math.sin(game.time * 0.08 + index) * 8;
        const rotation = game.time * 0.05;
        
        ctx.translate(item.x, screenY + bounce);
        ctx.rotate(rotation);
        
        if (item.type === 'gem') {
          ctx.shadowBlur = 20;
          ctx.shadowColor = levelData.theme.accentColor;
          ctx.fillStyle = levelData.theme.accentColor;
          ctx.beginPath();
          ctx.moveTo(0, -14);
          ctx.lineTo(-10, 0);
          ctx.lineTo(0, 14);
          ctx.lineTo(10, 0);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.shadowBlur = 25;
          ctx.shadowColor = '#4caf50';
          ctx.fillStyle = '#4caf50';
          ctx.beginPath();
          ctx.arc(0, 0, 15, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 18px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('★', 0, 6);
        }
        
        ctx.restore();
      }
    });

    levelData.obstacles.forEach((obstacle) => {
      let obstacleY = obstacle.y;
      let obstacleX = obstacle.x;
      
      if (obstacle.platformIndex !== undefined && levelData.platforms[obstacle.platformIndex]) {
        const platform = levelData.platforms[obstacle.platformIndex];
        let platformX = platform.x;
        
        if (platform.type === 'moving') {
          const platformState = game.platformStates.get(obstacle.platformIndex);
          if (platformState) {
            platformX += platformState.offset;
          }
        }
        obstacleY = platform.y - 25;
        obstacleX = obstacle.x;
      }
      
      if (obstacle.floating) {
        obstacleX = obstacle.x + Math.sin(game.time * 0.02) * 50;
        obstacleY = obstacle.y + Math.cos(game.time * 0.03) * 30;
      }
      
      const screenY = obstacleY - camera.y;
      if (screenY > -50 && screenY < CANVAS_HEIGHT + 50) {
        ctx.save();
        
        if (obstacle.type === 'spike') {
          ctx.fillStyle = '#9e9e9e';
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#000000';
          for (let i = 0; i < obstacle.width / 15; i++) {
            ctx.beginPath();
            ctx.moveTo(obstacleX + i * 15, screenY + obstacle.height);
            ctx.lineTo(obstacleX + i * 15 + 7.5, screenY);
            ctx.lineTo(obstacleX + i * 15 + 15, screenY + obstacle.height);
            ctx.fill();
          }
        } else if (obstacle.type === 'fireball') {
          ctx.shadowBlur = 25;
          ctx.shadowColor = '#ff6347';
          const fireballGradient = ctx.createRadialGradient(obstacleX, screenY, 5, obstacleX, screenY, 15);
          fireballGradient.addColorStop(0, '#ffff00');
          fireballGradient.addColorStop(0.5, '#ff6347');
          fireballGradient.addColorStop(1, '#ff0000');
          ctx.fillStyle = fireballGradient;
          ctx.beginPath();
          ctx.arc(obstacleX, screenY, 15, 0, Math.PI * 2);
          ctx.fill();
        }
        
        ctx.restore();
        
        const obstacleLeft = obstacleX;
        const obstacleRight = obstacleX + (obstacle.width || 30);
        const obstacleTop = screenY;
        const obstacleBottom = screenY + (obstacle.height || 30);
        
        const playerLeft = player.x;
        const playerRight = player.x + player.width;
        const playerTop = player.y - camera.y;
        const playerBottom = player.y - camera.y + player.height;
        
        if (!player.invulnerable &&
            playerRight > obstacleLeft &&
            playerLeft < obstacleRight &&
            playerBottom > obstacleTop &&
            playerTop < obstacleBottom) {
          setLives(prev => prev - 1);
          player.invulnerable = true;
          setTimeout(() => { player.invulnerable = false; }, 2000);
          for (let i = 0; i < 20; i++) {
            createParticle(player.x + player.width / 2, player.y + player.height / 2, '#ff0000');
          }
          if (lives <= 1) setGameState('gameOver');
        }
      }
    });

    if (player.y < (levelData.goalHeight || -4200)) {
      setGameState('levelComplete');
    }

    const screenY = player.y - camera.y;
    ctx.save();
    ctx.translate(player.x + player.width / 2, screenY + player.height / 2);
    
    ctx.rotate(player.rotation);
    
    if (player.invulnerable && game.time % 10 < 5) {
      ctx.globalAlpha = 0.5;
    }
    
    ctx.shadowBlur = 25;
    ctx.shadowColor = levelData.theme.accentColor;
    
    const backpackGradient = ctx.createLinearGradient(-4, -player.height/2 + 6, -4, -player.height/2 + 24);
    backpackGradient.addColorStop(0, '#3b82f6');
    backpackGradient.addColorStop(1, '#1d4ed8');
    ctx.fillStyle = backpackGradient;
    ctx.fillRect(-5, -player.height/2 + 6, 10, 18);
    
    ctx.strokeStyle = '#1e40af';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4, -player.height/2 + 8);
    ctx.lineTo(-8, -player.height/2 + 16);
    ctx.moveTo(4, -player.height/2 + 8);
    ctx.lineTo(8, -player.height/2 + 16);
    ctx.stroke();
    
    ctx.fillStyle = '#1e40af';
    ctx.fillRect(-3, -player.height/2 + 12, 6, 6);
    
    const bodyGradient = ctx.createLinearGradient(-player.width/2 + 2, -player.height/2, player.width/2 - 2, player.height/2);
    bodyGradient.addColorStop(0, '#059669');
    bodyGradient.addColorStop(0.5, '#10b981');
    bodyGradient.addColorStop(1, '#16a34a');
    ctx.fillStyle = bodyGradient;
    ctx.fillRect(-player.width/2 + 3, -player.height/2 + 8, player.width - 6, player.height - 12);
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(-player.width/2 + 4, -player.height/2 + 9, 4, player.height - 14);
    ctx.fillRect(player.width/2 - 8, -player.height/2 + 9, 4, player.height - 14);
    
    ctx.fillStyle = '#78350f';
    ctx.fillRect(-player.width/2 + 3, 0, player.width - 6, 4);
    const buckleGradient = ctx.createRadialGradient(0, 1, 0, 0, 1, 4);
    buckleGradient.addColorStop(0, '#fde047');
    buckleGradient.addColorStop(1, '#fbbf24');
    ctx.fillStyle = buckleGradient;
    ctx.fillRect(-4, -1, 8, 6);
    
    const headGradient = ctx.createRadialGradient(0, -player.height/2 + 2, 2, 0, -player.height/2 + 3, 12);
    headGradient.addColorStop(0, '#fef3c7');
    headGradient.addColorStop(1, '#fcd34d');
    ctx.fillStyle = headGradient;
    ctx.beginPath();
    ctx.arc(0, -player.height/2 + 3, 11, 0, Math.PI * 2);
    ctx.fill();
    
    const hatGradient = ctx.createLinearGradient(0, -player.height/2 - 10, 0, -player.height/2);
    hatGradient.addColorStop(0, '#92400e');
    hatGradient.addColorStop(1, '#78350f');
    ctx.fillStyle = hatGradient;
    ctx.fillRect(-12, -player.height/2 - 4, 24, 4);
    ctx.fillRect(-8, -player.height/2 - 10, 16, 6);
    
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(-8, -player.height/2 - 5, 16, 2);
    
    const blink = game.time % 150 > 145 ? 0.3 : 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-4, -player.height/2 + 1, 3, 3.5 * blink, 0, 0, Math.PI * 2);
    ctx.ellipse(4, -player.height/2 + 1, 3, 3.5 * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    
    if (blink > 0.5) {
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(-4, -player.height/2 + 1, 1.5, 0, Math.PI * 2);
      ctx.arc(4, -player.height/2 + 1, 1.5, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.beginPath();
      ctx.arc(-3.5, -player.height/2 + 0.5, 0.8, 0, Math.PI * 2);
      ctx.arc(4.5, -player.height/2 + 0.5, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, -player.height/2 + 7, 4, 0.2, Math.PI - 0.2);
    ctx.stroke();
    
    const legCycle = Math.sin(game.time * 0.2) * 6;
    const isMoving = Math.abs(player.vx) > 0.5;
    
    ctx.strokeStyle = '#1e40af';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-5, player.height/2 - 8);
    ctx.lineTo(-5, player.height/2 + 2 + (isMoving ? legCycle : 0));
    ctx.stroke();
    
    const bootGradient1 = ctx.createRadialGradient(-5, player.height/2 + 3, 1, -5, player.height/2 + 4, 3);
    bootGradient1.addColorStop(0, '#92400e');
    bootGradient1.addColorStop(1, '#78350f');
    ctx.fillStyle = bootGradient1;
    ctx.fillRect(-8, player.height/2 + 2 + (isMoving ? legCycle : 0), 6, 4);
    
    ctx.strokeStyle = '#1e40af';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(5, player.height/2 - 8);
    ctx.lineTo(5, player.height/2 + 2 + (isMoving ? -legCycle : 0));
    ctx.stroke();
    
    const bootGradient2 = ctx.createRadialGradient(5, player.height/2 + 3, 1, 5, player.height/2 + 4, 3);
    bootGradient2.addColorStop(0, '#92400e');
    bootGradient2.addColorStop(1, '#78350f');
    ctx.fillStyle = bootGradient2;
    ctx.fillRect(2, player.height/2 + 2 + (isMoving ? -legCycle : 0), 6, 4);
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(3, player.height/2 + 2 + (isMoving ? -legCycle : 0), 2, 2);
    ctx.fillRect(-7, player.height/2 + 2 + (isMoving ? legCycle : 0), 2, 2);
    
    const armSwing = isMoving ? Math.sin(game.time * 0.2) * 8 : 0;
    ctx.strokeStyle = '#fcd34d';
    ctx.lineWidth = 4;
    
    ctx.beginPath();
    ctx.moveTo(-10, -player.height/2 + 12);
    ctx.lineTo(-12, player.height/2 - 8 + armSwing);
    ctx.stroke();
    
    ctx.fillStyle = '#fcd34d';
    ctx.beginPath();
    ctx.arc(-12, player.height/2 - 8 + armSwing, 3, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.beginPath();
    ctx.moveTo(10, -player.height/2 + 12);
    ctx.lineTo(12, player.height/2 - 8 - armSwing);
    ctx.stroke();
    
    ctx.fillStyle = '#fcd34d';
    ctx.beginPath();
    ctx.arc(12, player.height/2 - 8 - armSwing, 3, 0, Math.PI * 2);
    ctx.fill();
    
    if (player.hasDoubleJump) {
      ctx.fillStyle = '#4caf50';
      ctx.beginPath();
      ctx.arc(0, -player.height/2 - 8, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();

    particles.forEach((particle, index) => {
      particle.x += particle.vx * deltaTime;
      particle.y += particle.vy * deltaTime;
      particle.vy += 0.3 * deltaTime;
      particle.life -= 0.02 * deltaTime;

      if (particle.life <= 0) {
        particles.splice(index, 1);
        return;
      }

      const particleScreenY = particle.y - camera.y;
      ctx.save();
      ctx.globalAlpha = particle.life;
      ctx.fillStyle = particle.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particleScreenY, particle.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    if (player.y > CANVAS_HEIGHT + 100) {
      setLives(prev => prev - 1);
      player.x = CANVAS_WIDTH / 2 - PLAYER_SIZE / 2;
      player.y = CANVAS_HEIGHT - 100;
      player.vx = 0;
      player.vy = 0;
      if (lives <= 1) setGameState('gameOver');
    }

  }, [gameState, levelData, lives, score, showMenu]);

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
    setLives(3);
    setTheme('');
    setCustomTheme('');
    setLevelData(null);
    setShowMenu(false);
    setGameState('menu');
    gameRefs.current = {
      player: { x: CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, y: CANVAS_HEIGHT - 100, vx: 0, vy: 0, width: PLAYER_SIZE, height: PLAYER_SIZE, grounded: false, jumpCount: 0, hasDoubleJump: false, invulnerable: false, rotation: 0 },
      camera: { y: 0 },
      particles: [],
      collectedItems: new Set(),
      defeatedEnemies: new Set(),
      keys: {},
      platformStates: new Map(),
      enemyStates: new Map(),
      time: 0,
      highestY: CANVAS_HEIGHT - 100,
      lastFrameTime: 0
    };
  };

  const resetProgress = () => {
    const modalDiv = document.createElement('div');
    modalDiv.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 9999;';
    
    modalDiv.innerHTML = `
      <div style="background: linear-gradient(to br, #1e1b4b, #7c2d12); padding: 2rem; border-radius: 1rem; border: 3px solid #06b6d4; max-width: 400px; text-align: center;">
        <h2 style="color: #22d3ee; font-size: 1.5rem; font-weight: bold; margin-bottom: 1rem;">⚠️ Reset All Progress?</h2>
        <p style="color: #e5e7eb; margin-bottom: 2rem;">Are you sure you want to reset all progress? All unlocked zones and completed levels will be lost. This cannot be undone!</p>
        <div style="display: flex; gap: 1rem; justify-content: center;">
          <button id="confirmYes" style="padding: 0.75rem 2rem; background: linear-gradient(to r, #dc2626, #991b1b); color: white; font-weight: bold; border-radius: 0.5rem; border: none; cursor: pointer; font-size: 1rem;">Yes, Reset</button>
          <button id="confirmNo" style="padding: 0.75rem 2rem; background: linear-gradient(to r, #6b7280, #4b5563); color: white; font-weight: bold; border-radius: 0.5rem; border: none; cursor: pointer; font-size: 1rem;">No, Cancel</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modalDiv);
    
    const handleYes = () => {
      setProgress({ 'Sky Temple': 0 });
      localStorage.setItem('skyBattleProgress', JSON.stringify({ 'Sky Temple': 0 }));
      setLevel(1);
      setScore(0);
      setLives(3);
      setTheme('');
      setCustomTheme('');
      setShowMenu(false);
      setGameState('menu');
      gameRefs.current = {
        player: { x: CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, y: CANVAS_HEIGHT - 100, vx: 0, vy: 0, width: PLAYER_SIZE, height: PLAYER_SIZE, grounded: false, jumpCount: 0, hasDoubleJump: false, invulnerable: false, rotation: 0 },
        camera: { y: 0 },
        particles: [],
        collectedItems: new Set(),
        defeatedEnemies: new Set(),
        keys: {},
        platformStates: new Map(),
        enemyStates: new Map(),
        time: 0,
        highestY: CANVAS_HEIGHT - 100,
        lastFrameTime: 0
      };
      document.body.removeChild(modalDiv);
    };
    
    const handleNo = () => {
      document.body.removeChild(modalDiv);
    };
    
    document.getElementById('confirmYes').addEventListener('click', handleYes);
    document.getElementById('confirmNo').addEventListener('click', handleNo);
    
    modalDiv.addEventListener('click', (e) => {
      if (e.target === modalDiv) {
        handleNo();
      }
    });
  };

  const restartLevel = () => {
    setLives(3);
    setScore(0);
    gameRefs.current.collectedItems.clear();
    gameRefs.current.defeatedEnemies.clear();
    gameRefs.current.platformStates.clear();
    gameRefs.current.enemyStates.clear();
    gameRefs.current.particles = [];
    gameRefs.current.camera = { y: 0 };
    gameRefs.current.time = 0;
    gameRefs.current.highestY = CANVAS_HEIGHT - 100;
    gameRefs.current.player = {
      x: CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, y: CANVAS_HEIGHT - 100, vx: 0, vy: 0, width: PLAYER_SIZE, height: PLAYER_SIZE,
      grounded: false, jumpCount: 0, hasDoubleJump: false, invulnerable: false, rotation: 0
    };
    
    if (levelData && levelData.platforms) {
      levelData.platforms.forEach(platform => {
        if (platform.type === 'gone') {
          platform.type = 'disappearing';
          platform.opacity = 1;
        }
      });
    }
    
    setGameState('playing');
  };

  const nextLevel = () => {
    const currentTheme = theme === 'custom' ? customTheme : theme;
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
    } else {
      setLevel(newLevel);
    }
    
    setProgress(newProgress);
    localStorage.setItem('skyBattleProgress', JSON.stringify(newProgress));
    
    setCustomTheme('');
    setLevelData(null);
    setGameState('themeSelect');
    gameRefs.current.collectedItems.clear();
    gameRefs.current.defeatedEnemies.clear();
    gameRefs.current.platformStates.clear();
    gameRefs.current.enemyStates.clear();
    gameRefs.current.highestY = CANVAS_HEIGHT - 100;
    gameRefs.current.player = {
      x: CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, y: CANVAS_HEIGHT - 100, vx: 0, vy: 0, width: PLAYER_SIZE, height: PLAYER_SIZE,
      grounded: false, jumpCount: 0, hasDoubleJump: false, invulnerable: false, rotation: 0
    };
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-4 relative overflow-hidden" style={{ fontFamily: 'Lexend, sans-serif' }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 20 }, (_, i) => (
          <div
            key={i}
            className="absolute rounded-full opacity-20"
            style={{
              width: Math.random() * 100 + 50 + 'px',
              height: Math.random() * 100 + 50 + 'px',
              left: Math.random() * 100 + '%',
              top: Math.random() * 100 + '%',
              background: 'radial-gradient(circle, ' + ['#00d4ff', '#a855f7', '#ec4899', '#10b981'][i % 4] + ' 0%, transparent 70%)',
              animation: 'float ' + (Math.random() * 10 + 10) + 's ease-in-out infinite',
              animationDelay: (Math.random() * 5) + 's'
            }}
          />
        ))}
        {Array.from({ length: 5 }, (_, i) => {
          const angles = [-45, -30, -60, -50, -40];
          const angle = angles[i % angles.length];
          const startPositions = [
            { left: '-100px', top: `${10 + i * 15}%` },
            { right: '-100px', top: `${20 + i * 10}%` },
            { left: '-100px', top: `${30 + i * 12}%` },
            { left: `${20 + i * 15}%`, top: '-100px' },
            { right: `${10 + i * 20}%`, top: '-100px' }
          ];
          const startPos = startPositions[i % startPositions.length];
          
          return (
            <div
              key={`star-${i}`}
              className="absolute"
              style={{
                animation: `shootingStar${i} ${4 + Math.random() * 2}s linear infinite`,
                animationDelay: `${i * 3 + Math.random() * 2}s`,
                ...startPos
              }}
            >
              <div 
                className="relative"
                style={{
                  transform: `rotate(${angle}deg)`
                }}
              >
                <Star 
                  className="text-yellow-300 relative z-10" 
                  style={{ 
                    width: '24px', 
                    height: '24px',
                    filter: 'drop-shadow(0 0 8px rgba(253, 224, 71, 0.8))'
                  }} 
                  fill="currentColor"
                />
              </div>
            </div>
          );
        })}
      </div>
      
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700;800&display=swap');
        
        @keyframes float {
          0%, 100% { transform: translateY(0) translateX(0); }
          25% { transform: translateY(-30px) translateX(20px); }
          50% { transform: translateY(-60px) translateX(-20px); }
          75% { transform: translateY(-30px) translateX(20px); }
        }
        
        @keyframes shootingStar0 {
          0% {
            transform: translateX(0) translateY(0);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translateX(120vw) translateY(80vh);
            opacity: 0;
          }
        }
        
        @keyframes shootingStar1 {
          0% {
            transform: translateX(0) translateY(0);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translateX(-120vw) translateY(70vh);
            opacity: 0;
          }
        }
        
        @keyframes shootingStar2 {
          0% {
            transform: translateX(0) translateY(0);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translateX(100vw) translateY(90vh);
            opacity: 0;
          }
        }
        
        @keyframes shootingStar3 {
          0% {
            transform: translateX(0) translateY(0);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translateX(80vw) translateY(110vh);
            opacity: 0;
          }
        }
        
        @keyframes shootingStar4 {
          0% {
            transform: translateX(0) translateY(0);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translateX(-60vw) translateY(100vh);
            opacity: 0;
          }
        }
      `}</style>
      
      <div className="relative z-10">
      {gameState === 'menu' && (
        // 2026-05-11 — Menu compacted to fit the embedded iframe's
        // ~530-px height in the portal grid column. Was: 256-px logo
        // disc + text-7xl title + text-2xl subtitle + 12-px margins +
        // p-6 padding — overflowed and forced a scrollbar.
        <div className="text-center space-y-2 animate-fade-in py-2">
          <div className="relative">
            <div className="mx-auto w-24 h-24 mb-2 relative flex items-center justify-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-600 via-blue-500 to-cyan-400 flex items-center justify-center shadow-xl">
                <div className="w-[68px] h-[68px] rounded-full bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
                  <Rocket className="w-10 h-10 text-cyan-400" />
                </div>
              </div>
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              {t('gameTitle')}
            </h1>
          </div>
          <p className="text-base text-gray-300 max-w-md mx-auto">
            {t('gameSubtitle')}
          </p>
          <button
            onClick={() => setGameState('themeSelect')}
            className="px-8 py-3 bg-gradient-to-r from-cyan-500 via-purple-600 to-pink-600 rounded-xl font-bold text-lg hover:scale-105 transition-all duration-300 shadow-xl hover:shadow-cyan-500/50"
          >
            {t('startAdventure')}
          </button>
          <div className="text-xs text-gray-400 space-y-0.5 bg-black/30 px-4 py-2 rounded-lg backdrop-blur max-w-md mx-auto">
            <p className="font-semibold text-cyan-400 text-sm">Controls:</p>
            <p>{t('controlsArrow')} · {t('controlsJump')}</p>
            <p>{t('controlsDefeat')}</p>
          </div>
          <button
            onClick={resetProgress}
            className="px-4 py-1 bg-red-900/50 hover:bg-red-800/70 rounded-lg text-xs text-red-300 hover:text-red-100 transition-all"
          >
            Reset All Progress
          </button>
        </div>
      )}

      {gameState === 'themeSelect' && (
        <div className="text-center space-y-8 animate-fade-in max-w-5xl">
          <div className="flex items-center justify-center gap-4 mb-8">
            <button
              onClick={resetGame}
              className="px-6 py-3 bg-gradient-to-r from-slate-700 to-slate-600 rounded-xl font-bold text-lg hover:scale-105 transition-all duration-300 shadow-lg flex items-center gap-2"
            >
              <ArrowUp className="w-5 h-5 rotate-180" />
              Back to Menu
            </button>
          </div>
          <h2 className="text-5xl font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">
            Choose Your Battle Zone
          </h2>
          <p className="text-2xl text-cyan-300">Current Progress</p>
          
          <div className="flex flex-col gap-4 max-w-3xl mx-auto">
            {themes.map((themeItem, index) => {
              const Icon = themeItem.icon;
              const isUnlocked = progress.hasOwnProperty(themeItem.name);
              const completedLevels = progress[themeItem.name] || 0;
              const isComplete = completedLevels >= 5;
              
              return (
                <div key={themeItem.name} className="relative">
                  {index < themes.length - 1 && (
                    <div 
                      className="absolute left-1/2 -bottom-4 w-1 h-4 -translate-x-1/2 z-0"
                      style={{ 
                        backgroundColor: isComplete ? themeItem.color : '#334155',
                        boxShadow: isComplete ? `0 0 10px ${themeItem.color}` : 'none'
                      }}
                    />
                  )}
                  
                  <button
                    onClick={() => {
                      if (isUnlocked) {
                        const completedLevels = progress[themeItem.name] || 0;
                        const nextLevel = Math.min(completedLevels + 1, 5);
                        setTheme(themeItem.name);
                        setLevel(nextLevel);
                        // Pass theme directly to avoid state timing issues
                        generateLevel(nextLevel, themeItem.name);
                      }
                    }}
                    disabled={!isUnlocked}
                    className={`w-full p-6 rounded-2xl transition-all duration-300 group relative overflow-hidden ${
                      isUnlocked ? 'hover:scale-105 cursor-pointer' : 'cursor-not-allowed opacity-50'
                    }`}
                    style={{ 
                      backgroundColor: themeItem.bg, 
                      borderColor: isUnlocked ? themeItem.color : '#475569', 
                      borderWidth: '3px',
                      boxShadow: isComplete ? `0 0 20px ${themeItem.color}` : 'none'
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-transparent via-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    
                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex items-center space-x-4">
                        <Icon 
                          className="w-10 h-10 group-hover:scale-125 transition-transform drop-shadow-lg" 
                          style={{ color: isUnlocked ? themeItem.color : '#64748b' }} 
                        />
                        <div className="text-left">
                          <span className="font-bold text-xl block">{themeItem.name}</span>
                          {isUnlocked && (
                            <div className="flex gap-1 mt-1">
                              {[1, 2, 3, 4, 5].map(lvl => (
                                <div 
                                  key={lvl}
                                  className="w-8 h-2 rounded-full"
                                  style={{
                                    backgroundColor: lvl <= completedLevels ? themeItem.color : '#334155',
                                    boxShadow: lvl <= completedLevels ? `0 0 5px ${themeItem.color}` : 'none'
                                  }}
                                />
                              ))}
                            </div>
                          )}
                          <span className="text-xs text-gray-400 mt-1 block">
                            {completedLevels > 0 ? `${completedLevels * 100}m completed` : '100m - 500m'}
                          </span>
                        </div>
                      </div>
                      
                      <div className="text-right">
                        {!isUnlocked && (
                          <span className="text-sm font-bold text-gray-400">{t('locked')}</span>
                        )}
                        {isUnlocked && !isComplete && (
                          <span className="text-sm font-bold" style={{ color: themeItem.color }}>
                            {t('unlocked')}
                          </span>
                        )}
                        {isComplete && (
                          <span className="text-sm font-bold text-green-400">{t('complete')}</span>
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
          
          <div className="mt-8 text-sm text-gray-400">
            <p>Complete all 5 levels (500m) in each zone to unlock the next!</p>
          </div>
        </div>
      )}

      {isGenerating && (
        <div className="text-center space-y-6 animate-fade-in">
          <Sparkles className="w-20 h-20 mx-auto animate-spin text-cyan-400" />
          <h2 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">
            {t('generatingLevel')}
          </h2>
          <p className="text-xl text-gray-300">{t('creatingExperience')}</p>
          <p className="text-sm text-purple-400 animate-pulse">{t('buildingChallenges')}</p>
        </div>
      )}

      {gameState === 'playing' && (
        <div className="fixed inset-0 w-full h-full">
          <div 
            className="absolute top-4 left-4 z-20 bg-black/80 backdrop-blur px-6 py-3 rounded-xl border-2 shadow-lg"
            style={{ 
              borderColor: levelData?.theme.accentColor || '#06b6d4',
              boxShadow: `0 0 20px ${levelData?.theme.accentColor || '#06b6d4'}40`
            }}
          >
            <p 
              className="text-sm font-semibold"
              style={{ color: levelData?.theme.accentColor || '#06b6d4' }}
            >
              Level {level} - {level * 100}m
            </p>
            <p className="font-bold text-xl">{levelData?.levelName}</p>
            <p className="text-xs text-gray-400">{levelData?.levelDescription}</p>
          </div>
          <div 
            className="absolute top-4 right-4 z-20 bg-black/80 backdrop-blur px-6 py-3 rounded-xl border-2 shadow-lg min-w-[200px]"
            style={{ 
              borderColor: levelData?.theme.accentColor || '#a855f7',
              boxShadow: `0 0 20px ${levelData?.theme.accentColor || '#a855f7'}40`
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span 
                className="text-sm font-semibold"
                style={{ color: levelData?.theme.accentColor || '#a855f7' }}
              >
                {t('scoreLabel')}:
              </span>
              <span className="text-lg font-bold text-white">{score}</span>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span 
                className="text-sm font-semibold"
                style={{ color: levelData?.theme.accentColor || '#a855f7' }}
              >
                {t('heightLabel')}:
              </span>
              <span 
                className="text-lg font-bold"
                style={{ color: levelData?.theme.accentColor || '#06b6d4' }}
              >
                {height}m
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span 
                className="text-sm font-semibold"
                style={{ color: levelData?.theme.accentColor || '#a855f7' }}
              >
                Lives:
              </span>
              <div className="flex gap-1">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className={'w-6 h-6 ' + (i < lives ? 'text-red-500' : 'text-gray-600')}>
                    <Heart className="w-full h-full" fill={i < lives ? 'currentColor' : 'none'} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {showMenu && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
              <div className="bg-gradient-to-br from-slate-900 to-purple-900 p-10 rounded-2xl border-4 border-cyan-500 shadow-2xl space-y-6 min-w-[400px]">
                <h2 className="text-4xl font-bold text-center bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">
                  PAUSED
                </h2>
                <div className="space-y-4">
                  <button
                    onClick={() => setShowMenu(false)}
                    className="w-full px-8 py-4 bg-gradient-to-r from-green-500 to-cyan-600 rounded-xl font-bold text-xl hover:scale-105 transition-all duration-300 shadow-lg"
                  >
                    Resume Battle
                  </button>
                  <button
                    onClick={resetGame}
                    className="w-full px-8 py-4 bg-gradient-to-r from-slate-700 to-slate-600 rounded-xl font-bold text-xl hover:scale-105 transition-all duration-300 shadow-lg"
                  >
                    Main Menu
                  </button>
                </div>
                <p className="text-center text-sm text-gray-400 mt-4">
                  Press ESC to resume
                </p>
              </div>
            </div>
          )}
          
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="absolute inset-0"
          />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 text-center text-sm text-cyan-400 font-semibold bg-black/50 px-4 py-2 rounded-lg">
            {t('progressHint')}
          </div>
        </div>
      )}

      {gameState === 'levelComplete' && (
        <div className="text-center space-y-8 animate-fade-in">
          <Star className="w-24 h-24 mx-auto text-yellow-400 animate-bounce drop-shadow-lg" />
          <h2 className="text-5xl font-bold bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
            {t('levelComplete')}
          </h2>
          <div className="space-y-3 bg-black/40 p-8 rounded-2xl backdrop-blur">
            <p className="text-3xl font-bold text-cyan-400">{t('scoreLabel')}: {score}</p>
          </div>
          <button
            onClick={nextLevel}
            className="px-10 py-5 bg-gradient-to-r from-green-500 to-cyan-600 rounded-xl font-bold text-xl hover:scale-110 transition-all duration-300 shadow-2xl hover:shadow-green-500/50"
          >
            {t('nextLevel')}
          </button>
        </div>
      )}

      {gameState === 'gameOver' && (
        <div className="text-center space-y-8 animate-fade-in">
          <div className="text-6xl">💔</div>
          <h2 className="text-5xl font-bold text-red-400">{t('gameOver')}</h2>
          <div className="space-y-3 bg-black/40 p-8 rounded-2xl backdrop-blur">
            <p className="text-2xl text-cyan-400">{t('scoreLabel')}: {score}</p>
            <p className="text-2xl text-purple-400">{t('heightLabel')}: {height}m</p>
          </div>
          <p className="text-xl text-gray-300">{t('levelLabel')} {level} - {levelData?.levelName || theme}</p>
          <div className="space-y-4">
            <button
              onClick={restartLevel}
              className="block w-72 mx-auto px-10 py-5 bg-gradient-to-r from-blue-600 to-purple-700 rounded-xl font-bold text-xl hover:scale-110 transition-all duration-300 shadow-2xl"
            >
              {t('retryLevel')}
            </button>
            <button
              onClick={resetGame}
              className="block w-72 mx-auto px-8 py-4 bg-slate-700 hover:bg-slate-600 rounded-xl font-bold hover:scale-105 transition-all duration-300"
            >
              {t('backToMenu')}
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default ClimberGame;