import * as THREE from 'three';
import { COMBAT, DEFAULT_SETTINGS, FLIGHT, FREEROAM, MULTIPLAYER, OUTLAW, PICKUPS, WEAPONS } from './core/config';
// COMBAT hit radii + aim assist used for arcade-readable dogfights
import { Input } from './core/Input';
import type { GameMode, MapId, SessionConfig, Settings, WeaponId } from './core/types';
import { AudioSystem } from './audio/AudioSystem';
import { FlightController } from './flight/FlightController';
import { VehiclePawn } from './vehicle/VehiclePawn';
import { WeaponSystem } from './weapons/WeaponSystem';
import { MissileLock } from './weapons/MissileLock';
import { ShieldSystem } from './shield/ShieldSystem';
import { ArenaMap } from './world/ArenaMap';
import { PickupSystem } from './world/PickupSystem';
import { AIPilot } from './ai/AIPilot';
import { Effects } from './fx/Effects';
import { DamageFloats } from './fx/DamageFloats';
import { HUD } from './hud/HUD';
import { LocalBotAdapter } from './net/LocalBotAdapter';
import { Menu, SettingsUI, ResultsUI, LoadingUI } from './ui/Menu';

/** Per-sector rival snapshot (one instance per biome). */
interface BiomeRivalSnap {
  callsign: string;
  color: number;
  personaIndex: number;
  position: [number, number, number];
  health: number;
  shield: number;
  kills: number;
  deaths: number;
  score: number;
  alive: boolean;
}

interface BiomeInstanceSnap {
  rivals: BiomeRivalSnap[];
  pickups: { time: number; items: Array<{ alive: boolean; respawnAt: number }> };
}

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private input: Input;
  private settings: Settings = { ...DEFAULT_SETTINGS };

  private menu = new Menu();
  private settingsUI: SettingsUI;
  private results = new ResultsUI();
  private loading = new LoadingUI();
  private hud = new HUD();
  private audio: AudioSystem;

  private net = new LocalBotAdapter();
  private map: ArenaMap;
  private flight = new FlightController();
  private localPawn: VehiclePawn;
  private weapons: WeaponSystem;
  private missileLock = new MissileLock();
  private shield = new ShieldSystem();
  private effects: Effects;
  private dmgFloats = new DamageFloats();
  private bots: AIPilot[] = [];
  private pickups = new PickupSystem();
  /**
   * One living instance per biome for this session.
   * Portals = travel between instances (leave this pack, join theirs).
   * NPCs do not follow you across biomes.
   */
  private biomeInstances = new Map<MapId, BiomeInstanceSnap>();

  private mode: GameMode = 'freeroam';
  private mapId: MapId = 'sky-city';
  private playing = false;
  private matchTime = 0;
  private matchLimit = 0;
  private lives = OUTLAW.lives;
  private outlawRound = 0;
  private outlawKillsNeeded = 0;
  private outlawKills = 0;
  private respawnTimer = -1;
  private dead = false;
  private scoreboardOpen = false;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private aimOrigin = new THREE.Vector3();
  private aimDir = new THREE.Vector3();
  private collNormal = new THREE.Vector3();
  private prevWeaponKeys = new Set<string>();
  private frame = 0;
  private portalCooldown = 0;
  private traveling = false;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fps = 0;
  private _f3Latch = false;
  private _hLatch = false;
  private _escLatch = false;
  private _mLatch = false;
  private pauseMode: 'engage' | 'pause' = 'engage';

  // Side mirrors
  private mirrorLeftCam: THREE.PerspectiveCamera;
  private mirrorRightCam: THREE.PerspectiveCamera;
  private mirrorLeftRT: THREE.WebGLRenderTarget;
  private mirrorRightRT: THREE.WebGLRenderTarget;
  private mirrorLeftCanvas: HTMLCanvasElement;
  private mirrorRightCanvas: HTMLCanvasElement;
  private mirrorLeftCtx: CanvasRenderingContext2D;
  private mirrorRightCtx: CanvasRenderingContext2D;
  private mirrorBuf = new Uint8Array(128 * 96 * 4);

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    if (!this.canvas) throw new Error('Missing #game-canvas');

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch (e) {
      throw new Error(`WebGL init failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera = new THREE.PerspectiveCamera(FLIGHT.fovNormal, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.input = new Input(this.canvas);
    this.audio = new AudioSystem(this.settings);
    this.settingsUI = new SettingsUI(this.settings);
    this.map = new ArenaMap(this.scene, 'sky-city');
    this.localPawn = new VehiclePawn(0x00f0ff, true);
    this.scene.add(this.localPawn.group);
    this.weapons = new WeaponSystem(this.scene);
    this.effects = new Effects(this.scene);
    this.scene.add(this.pickups.group);

    // Mirrors (optional if HUD nodes missing)
    this.mirrorLeftCam = new THREE.PerspectiveCamera(50, 4 / 3, 0.5, 400);
    this.mirrorRightCam = new THREE.PerspectiveCamera(50, 4 / 3, 0.5, 400);
    this.mirrorLeftRT = new THREE.WebGLRenderTarget(128, 96);
    this.mirrorRightRT = new THREE.WebGLRenderTarget(128, 96);
    this.mirrorLeftCanvas = document.createElement('canvas');
    this.mirrorLeftCanvas.width = 128;
    this.mirrorLeftCanvas.height = 96;
    this.mirrorRightCanvas = document.createElement('canvas');
    this.mirrorRightCanvas.width = 128;
    this.mirrorRightCanvas.height = 96;
    const ml = document.getElementById('mirror-left');
    const mr = document.getElementById('mirror-right');
    if (ml) ml.appendChild(this.mirrorLeftCanvas);
    if (mr) mr.appendChild(this.mirrorRightCanvas);
    this.mirrorLeftCtx = this.mirrorLeftCanvas.getContext('2d')!;
    this.mirrorRightCtx = this.mirrorRightCanvas.getContext('2d')!;

    this.bindUI();
    window.addEventListener('resize', this.onResize);
    this.menu.show(true);
    this.menu.setStatus('SELECT A MODE TO LAUNCH');
    this.animate();
    // Warm default map after first paint so the menu is never stuck behind city gen.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          this.map.load('sky-city');
        } catch (e) {
          console.warn('[NEON VEIL] warmup map load failed', e);
        }
      });
    });
  }

  private bindUI() {
    this.menu.onStartGame((cfg) => void this.startSession(cfg));
    this.menu.onOpenSettings(() => this.settingsUI.show(true));
    this.settingsUI.onSettingsChange((s) => {
      this.settings = s;
      this.audio.applySettings(s);
      localStorage.setItem('neonveil_settings', JSON.stringify(s));
    });
    this.results.onReturn(() => this.returnToMenu());

    const saved = localStorage.getItem('neonveil_settings');
    if (saved) {
      try {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
        this.audio.applySettings(this.settings);
      } catch {
        /* ignore */
      }
    }

    const engage = () => this.resumeFromPause();
    document.getElementById('btn-resume')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      engage();
    });
    document.getElementById('btn-pause-settings')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.settingsUI.show(true);
    });
    document.getElementById('btn-pause-menu')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hud.setClickToPlay(false);
      this.returnToMenu();
    });
    const ctp = document.getElementById('click-to-play');
    ctp?.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        engage();
      }
    });

    // ForgeFlow bottom-right bar: pause / mute hooks (game_controls.js)
    this.wireForgeFlowShell();
  }

  /** Expose pause + mute to shared ForgeFlow game_controls bar. */
  private wireForgeFlowShell() {
    const w = window as unknown as {
      __PAUSE__?: {
        toggle: () => void;
        pause: () => void;
        resume: () => void;
      };
    };
    w.__PAUSE__ = {
      toggle: () => {
        if (!this.playing) return;
        if (this.hud.isPauseOpen()) this.resumeFromPause();
        else this.openPauseMenu('pause');
      },
      pause: () => {
        if (this.playing && !this.hud.isPauseOpen()) this.openPauseMenu('pause');
      },
      resume: () => {
        if (this.playing && this.hud.isPauseOpen()) this.resumeFromPause();
      },
    };

    window.addEventListener('mutechange', ((e: CustomEvent<{ muted?: boolean }>) => {
      const muted = !!(e.detail && e.detail.muted);
      this.settings = { ...this.settings, mute: muted };
      this.settingsUI.setMute(muted);
      this.audio.applySettings(this.settings);
      try {
        localStorage.setItem('neonveil_settings', JSON.stringify(this.settings));
      } catch {
        /* ignore */
      }
    }) as EventListener);

    // If bar already restored mute from localStorage before we booted
    try {
      const ctrl = (window as unknown as { __CONTROLS__?: { isMuted?: () => boolean } }).__CONTROLS__;
      if (ctrl?.isMuted?.()) {
        this.settings = { ...this.settings, mute: true };
        this.settingsUI.setMute(true);
        this.audio.applySettings(this.settings);
      }
    } catch {
      /* ignore */
    }
  }

  /** Resume flight from unified Esc pause / engage panel. */
  private resumeFromPause() {
    void this.audio.unlock();
    this.input.engage();
    this.hud.setClickToPlay(false);
    this.hud.setEngageHint(this.input.lockError);
    this.settingsUI.show(false);
  }

  /** Esc pause — same panel as click-to-engage. */
  private openPauseMenu(mode: 'engage' | 'pause' = 'pause') {
    this.pauseMode = mode;
    this.input.disengage();
    this.settingsUI.show(false);
    this.hud.setClickToPlay(true, mode);
  }

  private async startSession(cfg: SessionConfig) {
    this.mode = cfg.mode;
    this.mapId = cfg.mapId;
    this.menu.show(false);
    this.results.show(false);
    this.loading.show(true);
    this.loading.set(0.08, 'Linking thrusters…');

    try {
      // Yield so the loading screen can paint before heavy work.
      await nextFrame();
      await this.net.connect(cfg.callsign);
      this.loading.set(0.25, 'Building neon skyline…');
      await nextFrame();

      this.biomeInstances.clear();
      this.clearBots();
      this.map.load(cfg.mapId);
      this.audio.setBiomeMusic(cfg.mapId);
      this.pickups.spawnForMap(this.map.def.bounds, PICKUPS.mapCount);
      this.loading.set(0.65, 'Calibrating weapons…');
      await nextFrame();

      // Fresh instance for starting sector (each biome has its own NPC pack)
      this.populateBiomeInstance(cfg.mapId, true);

      const spawn = this.map.randomSpawn();
      this.flight.reset(spawn, Math.random() * Math.PI * 2);
      this.shield.reset();
      this.weapons.unlocked = new Set(['plasma']);
      this.weapons.ammo.laser = 0;
      this.weapons.ammo.torpedo = 0;
      this.weapons.ammo.scatter = 0;
      this.weapons.refill();
      this.weapons.select('plasma');
      this.dead = false;
      this.respawnTimer = -1;
      this.matchTime = 0;
      this.lives = OUTLAW.lives;
      this.outlawRound = 0;
      this.outlawKills = 0;

      if (cfg.mode === 'multiplayer') {
        this.matchLimit = MULTIPLAYER.matchTime;
        this.hud.setModeBanner(
          `FFA · ${this.alivePilotCount()} IN THIS SECTOR · RINGS = OTHER SECTORS`
        );
      } else if (cfg.mode === 'outlaw') {
        this.matchLimit = OUTLAW.roundTime;
        this.outlawKillsNeeded = OUTLAW.targetsPerRound[0];
        this.hud.setModeBanner(`OUTLAW HUNT · ROUND 1/${OUTLAW.rounds}`);
      } else {
        this.matchLimit = 0;
        this.hud.setModeBanner(
          `FREE ROAM · ${this.alivePilotCount()} HERE · RINGS TRAVEL TO OTHER SECTORS`
        );
      }

      this.net.pushLocal({
        callsign: cfg.callsign,
        alive: true,
        health: COMBAT.maxHealth,
        shield: COMBAT.maxShield,
        kills: 0,
        deaths: 0,
        score: 0,
      });

      this.loading.set(1, 'Ready');
      await sleep(200);
      this.loading.show(false);
      this.playing = true;
      this.input.disengage();
      this.hud.show(true);
      this.openPauseMenu('engage');
      this.hud.setEngageHint(null);
      this.clock.start();
    } catch (err) {
      console.error('[NEON VEIL] startSession failed', err);
      this.loading.set(0, 'Launch fault — returning to menu');
      await sleep(900);
      this.loading.show(false);
      this.playing = false;
      this.hud.show(false);
      this.menu.show(true);
      const detail = err instanceof Error ? err.message : String(err);
      this.menu.setStatus(`LAUNCH FAILED: ${detail}`);
    }
  }

  private returnToMenu() {
    this.playing = false;
    this.hud.show(false);
    this.hud.showDeath(false);
    this.hud.setClickToPlay(false);
    this.input.disengage();
    this.stashCurrentBiome();
    this.clearBots();
    this.biomeInstances.clear();
    this.menu.show(true);
  }

  private clearBots() {
    for (const b of this.bots) {
      this.scene.remove(b.pawn.group);
      b.dispose();
    }
    this.bots = [];
  }

  private desiredRivalCount(): number {
    if (this.mode === 'multiplayer') return MULTIPLAYER.botCount;
    if (this.mode === 'outlaw') return this.outlawKillsNeeded || OUTLAW.targetsPerRound[0];
    return FREEROAM.rivalCount;
  }

  private alivePilotCount(): number {
    return 1 + this.bots.filter((b) => b.state.alive).length;
  }

  private spawnBotPawns() {
    this.clearBots();
    const colors = [0xff2bd6, 0xff6b2b, 0x39ff88, 0xffe566, 0xaa66ff, 0x00aaff, 0xff88cc, 0x66ffcc];
    let i = 0;
    for (const p of this.net.getPlayers()) {
      if (!p.isBot) continue;
      const bot = new AIPilot(p, colors[i % colors.length], i);
      const sp = this.map.randomSpawn();
      bot.respawn(sp);
      this.scene.add(bot.pawn.group);
      this.bots.push(bot);
      i++;
    }
  }

  /** Snapshot this sector’s NPCs + crates (they stay here when you portal out). */
  private stashCurrentBiome() {
    if (!this.mapId) return;
    const palette = [0xff2bd6, 0xff6b2b, 0x39ff88, 0xffe566, 0xaa66ff, 0x00aaff, 0xff88cc, 0x66ffcc];
    const rivals: BiomeRivalSnap[] = this.bots.map((b, i) => {
      let color = palette[i % palette.length];
      const mat = (b.marker.children[0] as THREE.Mesh | undefined)?.material as
        | THREE.MeshBasicMaterial
        | undefined;
      if (mat?.color) color = mat.color.getHex();
      return {
        callsign: b.state.callsign,
        color,
        personaIndex: i,
        position: [b.state.position[0], b.state.position[1], b.state.position[2]] as [
          number,
          number,
          number,
        ],
        health: b.state.health,
        shield: b.state.shield,
        kills: b.state.kills,
        deaths: b.state.deaths,
        score: b.state.score,
        alive: b.state.alive,
      };
    });
    this.biomeInstances.set(this.mapId, {
      rivals,
      pickups: this.pickups.exportState(),
    });
  }

  /**
   * Enter a biome instance: restore its pack or create a full new one.
   * Portals switch instances — they do NOT drag NPCs with you.
   */
  private populateBiomeInstance(mapId: MapId, forceFresh: boolean) {
    const snap = forceFresh ? undefined : this.biomeInstances.get(mapId);
    const want = this.desiredRivalCount();
    const colors = [0xff2bd6, 0xff6b2b, 0x39ff88, 0xffe566, 0xaa66ff, 0x00aaff, 0xff88cc, 0x66ffcc];

    if (!snap || snap.rivals.length === 0) {
      this.net.spawnBots(want, false);
      this.spawnBotPawns();
      // Keep instance seeded so revisiting is stable
      this.stashCurrentBiome();
      return;
    }

    // Rebuild net + pawns from saved sector state
    this.net.spawnBots(snap.rivals.length, false);
    const players = this.net.getPlayers().filter((p) => p.isBot);
    this.clearBots();
    for (let i = 0; i < players.length; i++) {
      const saved = snap.rivals[i];
      const p = players[i];
      if (!saved || !p) continue;
      p.callsign = saved.callsign;
      p.health = saved.health;
      p.shield = saved.shield;
      p.kills = saved.kills;
      p.deaths = saved.deaths;
      p.score = saved.score;
      p.alive = saved.alive;
      p.position = [...saved.position] as [number, number, number];
      const bot = new AIPilot(p, saved.color || colors[i % colors.length], saved.personaIndex);
      if (saved.alive) {
        bot.respawn(new THREE.Vector3(...saved.position));
        bot.state.health = saved.health;
        bot.state.shield = saved.shield;
        bot.state.kills = saved.kills;
        bot.state.deaths = saved.deaths;
        bot.state.score = saved.score;
      } else {
        bot.state.alive = false;
        bot.pawn.group.visible = false;
      }
      this.scene.add(bot.pawn.group);
      this.bots.push(bot);
    }

    // Top up if config wants more than when this sector was last visited
    if (this.bots.length < want && this.mode !== 'outlaw') {
      this.net.spawnBots(want, false);
      this.spawnBotPawns();
    } else if (this.mode !== 'outlaw') {
      for (const bot of this.bots) {
        if (!bot.state.alive) bot.respawn(this.map.randomSpawn());
      }
    }

    this.pickups.importState(snap.pickups);
  }

  /** Keep current sector stocked (respawns stay in THIS instance only). */
  private ensureRivalPopulation() {
    const want = this.desiredRivalCount();
    if (this.mode === 'outlaw') return;
    for (const bot of this.bots) {
      if (!bot.state.alive) bot.respawn(this.map.randomSpawn());
    }
    if (this.bots.length < want) {
      this.net.spawnBots(want, false);
      this.spawnBotPawns();
    }
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.4) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
    if (this.playing) this.update(dt);
    this.render();
  };

  private update(dt: number) {
    this.handleUIKeys();

    // Keep pause panel in sync if pointer-lock Esc dropped engage without our key handler
    if (!this.dead && !this.input.isControlActive() && !this.hud.isPauseOpen() && !this.traveling) {
      this.openPauseMenu(this.pauseMode === 'engage' ? 'engage' : 'pause');
    }
    if (!this.dead && this.input.isControlActive() && this.input.lockError) {
      this.hud.setEngageHint(this.input.lockError);
    }

    // Death / respawn
    if (this.dead) {
      this.respawnTimer -= dt;
      this.hud.showDeath(true, `Respawning in ${Math.ceil(Math.max(0, this.respawnTimer))}…`);
      if (this.respawnTimer <= 0) {
        this.doRespawn();
      }
      this.weapons.update(dt);
      this.effects.update(dt);
      this.dmgFloats.update(dt, this.camera, window.innerWidth, window.innerHeight);
      this.updateBots(dt);
      this.syncLocalState();
      this.updateHud(dt);
      this.input.endFrame();
      return;
    }

    // Flight (input + velocity) — then substep position vs buildings so we can't tunnel
    const prevPos = this.tmpV2.copy(this.flight.position);
    this.flight.update(
      dt,
      this.input,
      this.settings,
      this.map.def.minAlt,
      this.map.def.maxAlt,
      this.map.def.bounds
    );
    // Rewind full integration; re-apply in substeps with solid resolves
    const endPos = this.tmpV.copy(this.flight.position);
    this.flight.position.copy(prevPos);
    const moveDist = prevPos.distanceTo(endPos);
    const steps = Math.max(1, Math.min(12, Math.ceil(moveDist / 1.25)));
    const stepDt = dt / steps;
    let impactDmg = 0;
    for (let s = 0; s < steps; s++) {
      this.flight.integrateSubstep(stepDt);
      if (this.map.city.resolveSolid(this.flight.position, 1.55, this.collNormal, 5)) {
        impactDmg = Math.max(impactDmg, this.flight.bounce(this.collNormal));
      }
    }
    // Final hard resolve + world clamps
    if (this.map.city.resolveSolid(this.flight.position, 1.55, this.collNormal, 4)) {
      impactDmg = Math.max(impactDmg, this.flight.bounce(this.collNormal));
    }
    this.flight.clampWorld(this.map.def.minAlt, this.map.def.maxAlt, this.map.def.bounds);
    if (impactDmg > 4) {
      this.applyDamageToLocal(impactDmg, 'world');
      this.audio.playHit();
    }

    // Shield
    const shieldEvt = this.shield.update(dt, this.input.isDown('KeyF'));
    if (shieldEvt === 'up') this.audio.playShieldUp();
    if (shieldEvt === 'down') this.audio.playShieldDown();
    this.localPawn.setShield(this.shield.deployed);

    // Weapons 1–6
    if (this.input.wheel) this.weapons.cycle(this.input.wheel > 0 ? 1 : -1);
    for (const [code, slot] of [
      ['Digit1', 1],
      ['Digit2', 2],
      ['Digit3', 3],
      ['Digit4', 4],
      ['Digit5', 5],
      ['Digit6', 6],
    ] as const) {
      if (this.input.isDown(code) && !this.prevWeaponKeys.has(code)) this.weapons.trySelectSlot(slot);
    }
    this.prevWeaponKeys = new Set([...this.input.keys].filter((k) => k.startsWith('Digit')));

    const homingTargets = [
      ...this.bots.map((b) => ({
        id: b.state.id,
        position: b.pawn.group.position,
        alive: b.state.alive,
      })),
      {
        id: this.net.localId,
        position: this.flight.position,
        alive: !this.dead && this.net.getLocal().alive,
      },
    ];
    this.weapons.update(dt, homingTargets);
    this.updateMissileLock(dt);
    if (this.input.isMouseDown(0) && this.input.isControlActive()) {
      this.tryPlayerFire();
    }

    // Pickups
    this.pickups.update(dt);
    const grabbed = this.pickups.tryCollect(this.flight.position, PICKUPS.collectRadius);
    if (grabbed) this.applyPickup(grabbed);

    // Projectiles collision
    this.resolveProjectiles();

    // Pawn transform
    this.localPawn.setTransform(this.flight.position, this.flight.quaternion);
    this.localPawn.setBoost(this.flight.boosting ? 1 : this.flight.speed / FLIGHT.maxSpeed);
    this.localPawn.group.visible = true;

    // Camera
    const fovTarget = this.flight.zooming ? 45 : this.flight.boosting ? FLIGHT.fovBoost : FLIGHT.fovNormal;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fovTarget, 1 - Math.exp(-8 * dt));
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.flight.position);
    this.flight.getCameraQuaternion(this.tmpQ);
    this.camera.quaternion.copy(this.tmpQ);
    // Slight cockpit offset
    this.camera.position.addScaledVector(this.tmpV.set(0, 0.15, 0.1).applyQuaternion(this.camera.quaternion), 1);

    this.audio.setEngineThrust(
      THREE.MathUtils.clamp(this.flight.speed / FLIGHT.maxSpeed, 0, 1),
      this.flight.boosting
    );

    // Push local position into net first so AI sees everyone equally this frame
    this.syncLocalState();
    this.updateBots(dt);
    this.effects.update(dt);
    this.dmgFloats.update(dt, this.camera, window.innerWidth, window.innerHeight);
    const hazardTargets = [
      { pos: this.flight.position, id: this.net.localId },
      ...this.bots
        .filter((b) => b.state.alive)
        .map((b) => ({ pos: b.pawn.group.position, id: b.state.id })),
    ];
    const hazards = this.map.update(dt, hazardTargets);
    for (const h of hazards) {
      if (h.kind === 'lightning') {
        // Apply to nearest pilot at strike (Atmosphere already aimed at a victim)
        let bestId = this.net.localId;
        let bestD = this.flight.position.distanceToSquared(h.position);
        for (const b of this.bots) {
          if (!b.state.alive) continue;
          const d = b.pawn.group.position.distanceToSquared(h.position);
          if (d < bestD) {
            bestD = d;
            bestId = b.state.id;
          }
        }
        if (bestId === this.net.localId && bestD < 400) {
          this.applyDamageToLocal(h.damage, 'world');
          this.flight.applyStun(h.stun);
          this.hud.showPickupToast('LIGHTNING STRIKE!');
          this.audio.playHit();
          this.effects.hitSpark(this.flight.position, 0xaaccff);
        } else {
          const bot = this.bots.find((b) => b.state.id === bestId);
          if (bot && bestD < 400) {
            bot.takeDamage(h.damage);
            this.effects.hitSpark(bot.pawn.group.position, 0xaaccff);
          }
        }
      } else if (h.kind === 'meteor') {
        if (this.flight.position.distanceTo(h.position) < 8) {
          this.applyDamageToLocal(h.damage, 'world');
          this.flight.applyStun(h.stun);
          this.audio.playExplosion();
          this.effects.explode(h.position, 2, 0xff6622);
        } else {
          for (const b of this.bots) {
            if (!b.state.alive) continue;
            if (b.pawn.group.position.distanceTo(h.position) < 8) {
              const killed = b.takeDamage(h.damage);
              this.effects.explode(h.position, 2, 0xff6622);
              if (killed) this.onKill('world', b.state.id, 'rocket', b.pawn.group.position);
              break;
            }
          }
        }
      }
    }
    // Satellite / meteor solid spheres
    for (const s of this.map.atmosphere.getSolidSpheres()) {
      if (this.flight.position.distanceTo(s.pos) < s.radius + 1.5) {
        this.tmpV.copy(this.flight.position).sub(s.pos).normalize();
        if (this.tmpV.lengthSq() < 0.01) this.tmpV.set(0, 1, 0);
        this.collNormal.copy(this.tmpV);
        this.flight.position.addScaledVector(this.collNormal, s.radius + 1.6 - this.flight.position.distanceTo(s.pos));
        this.flight.bounce(this.collNormal, 0.6);
      }
    }
    this.net.tick(dt);

    // Biome portals
    this.portalCooldown = Math.max(0, this.portalCooldown - dt);
    if (!this.traveling && this.portalCooldown <= 0 && !this.dead) {
      const hit = this.map.checkPortal(this.flight.position);
      if (hit) void this.travelPortal(hit.target, hit.label);
    }

    // Match timers / modes
    this.matchTime += dt;
    this.updateModeLogic();

    this.updateHud(dt);
    this.input.endFrame();
  }

  private async travelPortal(target: MapId, label: string) {
    if (this.traveling || target === this.mapId) return;
    this.traveling = true;
    this.portalCooldown = 3;
    try {
      this.hud.showBiomeToast(label);
      this.audio.playWarp();
      this.loading.show(true);
      this.loading.set(0.15, `Leaving sector…`);
      await nextFrame();

      // Freeze this instance (NPCs + crates stay behind)
      this.stashCurrentBiome();
      this.clearBots();

      this.mapId = target;
      this.map.load(target);
      this.audio.setBiomeMusic(target);
      this.pickups.spawnForMap(this.map.def.bounds, PICKUPS.mapCount);
      this.loading.set(0.55, `Entering ${label} instance…`);
      await nextFrame();

      // Join (or create) the destination sector’s own pilot pack
      this.populateBiomeInstance(target, false);

      const spawn = this.map.randomSpawn();
      this.flight.reset(spawn, Math.random() * Math.PI * 2);
      this.hud.setModeBanner(
        `${label} · ${this.alivePilotCount()} PILOTS IN THIS SECTOR`
      );
      this.loading.set(1, 'Ready');
      await sleep(180);
      this.loading.show(false);
    } catch (err) {
      console.error('[NEON VEIL] portal travel failed', err);
      this.loading.show(false);
    } finally {
      this.traveling = false;
      this.portalCooldown = 2.5;
    }
  }

  private handleUIKeys() {
    const just = (code: string) => this.input.isDown(code);

    if (just('KeyH') && !this._hLatch) {
      this.hud.toggleHelp();
      this._hLatch = true;
    } else if (!just('KeyH')) this._hLatch = false;

    if (just('F3') && !this._f3Latch) {
      this.hud.toggleDebug();
      this._f3Latch = true;
    } else if (!just('F3')) this._f3Latch = false;

    this.scoreboardOpen = just('Tab') && this.input.isControlActive();
    this.hud.showScoreboard(this.scoreboardOpen && this.playing, this.net.getPlayers(), this.net.localId);

    // Esc = full pause menu (Settings / Main Menu). First launch uses engage-only.
    if (just('Escape') && this.playing) {
      if (!this._escLatch) {
        this._escLatch = true;
        const settingsOpen = !document.getElementById('settings')?.classList.contains('hidden');
        if (settingsOpen) {
          this.settingsUI.show(false);
        } else if (this.input.isControlActive()) {
          this.openPauseMenu('pause');
        } else if (this.hud.isPauseOpen()) {
          // Esc while panel open → resume only if it was pause; engage still needs click/Enter
          if (this.pauseMode === 'pause') this.resumeFromPause();
          else this.resumeFromPause();
        } else {
          this.openPauseMenu('pause');
        }
      }
    } else if (!just('Escape')) {
      this._escLatch = false;
    }

    // M = mute only if game_controls.js is NOT loaded (it owns M + bar icon).
    // When both listen, double-toggle cancels out — that was "M does nothing".
    if (just('KeyM') && !this._mLatch) {
      this._mLatch = true;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const hasShell = !!(window as unknown as { __CONTROLS__?: { toggleMute?: () => void } }).__CONTROLS__
        ?.toggleMute;
      if (!hasShell && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        this.toggleMuteLocal();
      }
    } else if (!just('KeyM')) {
      this._mLatch = false;
    }
  }

  private toggleMuteLocal() {
    const muted = !this.settings.mute;
    this.settings = { ...this.settings, mute: muted };
    this.settingsUI.setMute(muted);
    this.audio.applySettings(this.settings);
    try {
      localStorage.setItem('neonveil_settings', JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  private updateMissileLock(dt: number) {
    const rocketSelected = this.weapons.current === 'rocket';
    this.flight.getAimDirection(this.aimDir);
    this.aimOrigin.copy(this.flight.position);

    const cue = this.missileLock.update(
      dt,
      rocketSelected && this.input.isControlActive() && !this.dead,
      this.aimOrigin,
      this.aimDir,
      this.bots.map((b) => ({
        id: b.state.id,
        position: b.pawn.group.position,
        alive: b.state.alive,
      })),
      (from, to) => this.map.city.lineOfSight(from, to)
    );

    if (cue === 'tick') this.audio.playLockTick(this.missileLock.progress);
    else if (cue === 'locked') this.audio.playLockTone();
    else if (cue === 'lost') this.audio.playLockLost();

    // Project lock diamond onto target (or reticle while seeking)
    let screen: { x: number; y: number } | null = null;
    if (
      rocketSelected &&
      this.missileLock.targetId &&
      (this.missileLock.phase === 'locking' || this.missileLock.phase === 'locked')
    ) {
      this.tmpV.copy(this.missileLock.targetPos).project(this.camera);
      if (this.tmpV.z > -1 && this.tmpV.z < 1) {
        screen = {
          x: (this.tmpV.x * 0.5 + 0.5) * window.innerWidth,
          y: (-this.tmpV.y * 0.5 + 0.5) * window.innerHeight,
        };
      }
    }

    this.hud.updateMissileLock(
      rocketSelected && this.input.isControlActive(),
      rocketSelected ? this.missileLock.phase : 'off',
      this.missileLock.progress,
      screen
    );
  }

  private tryPlayerFire() {
    this.flight.getAimDirection(this.aimDir);
    this.applyAimAssist(this.aimDir);
    this.aimOrigin.copy(this.flight.position).addScaledVector(this.aimDir, 2.2);
    this.aimOrigin.y -= 0.1;

    const w = this.weapons.current;
    // Rockets: must be fully latched (red LOCK) before fire
    if (w === 'rocket' && !this.missileLock.locked) {
      return;
    }

    const result = this.weapons.fire(this.net.localId, this.aimOrigin, this.aimDir, {
      lockTargetId: w === 'rocket' || w === 'torpedo' ? this.missileLock.targetId : null,
      requireLock: w === 'rocket',
    });
    if (!result) return;

    if (w === 'plasma') this.audio.playPlasma();
    else if (w === 'rocket' || w === 'torpedo') this.audio.playRocket();
    else if (w === 'laser') this.audio.playLaser();
    else if (w === 'scatter') this.audio.playScatter();
    else this.audio.playRail();

    // Consume lock after a successful rocket shot (re-acquire for next)
    if (w === 'rocket') {
      this.missileLock.reset();
      this.hud.updateMissileLock(true, 'seeking', 0, null);
    }

    if (result.hitscan) {
      for (const h of result.hitscan) {
        this.resolveHitscan(h.ownerId, h.origin, h.direction, h.damage, h.weapon);
      }
    }
  }

  private applyPickup(def: import('./world/PickupSystem').PickupDef) {
    const local = this.net.getLocal();
    const floatAt = this.flight.position.clone();
    floatAt.y += 2;
    const delay = PICKUPS.respawnSec;
    if (def.kind === 'weapon' && def.weapon) {
      const ammo =
        def.weapon === 'rocket'
          ? PICKUPS.rocketPickupAmmo
          : def.amount > 1
            ? def.amount
            : WEAPONS[def.weapon].ammo;
      this.weapons.grantWeapon(def.weapon, ammo);
      this.hud.showPickupToast(`${def.label} · crate back in ${delay}s`);
      this.audio.playPickup();
    } else if (def.kind === 'health') {
      local.health = Math.min(COMBAT.maxHealth, local.health + def.amount);
      this.hud.showPickupToast(`HULL +${def.amount} · crate ${delay}s`);
      this.dmgFloats.spawn(floatAt, def.amount, 'heal');
      this.audio.playPickup();
    } else if (def.kind === 'shield') {
      this.shield.charge = Math.min(COMBAT.maxShield, this.shield.charge + def.amount);
      local.shield = this.shield.charge;
      this.hud.showPickupToast(`SHIELD +${def.amount} · crate ${delay}s`);
      this.dmgFloats.spawn(floatAt, def.amount, 'heal');
      this.audio.playPickup();
    } else if (def.kind === 'ammo') {
      this.weapons.grantAmmoAll(0.6);
      this.hud.showPickupToast(`AMMO RELOAD · crate ${delay}s`);
      this.audio.playPickup();
    }
  }

  /** Pull aim slightly toward nearest foe in cone — arcade, not aimbot. */
  private applyAimAssist(dir: THREE.Vector3) {
    const cone = COMBAT.aimAssistCone;
    const range = COMBAT.aimAssistRange;
    const strength = COMBAT.aimAssist;
    if (strength <= 0) return;
    let bestDot = Math.cos(cone);
    let bestDir: THREE.Vector3 | null = null;
    for (const bot of this.bots) {
      if (!bot.state.alive) continue;
      this.tmpV.copy(bot.pawn.group.position).sub(this.flight.position);
      const dist = this.tmpV.length();
      if (dist < 4 || dist > range) continue;
      this.tmpV.multiplyScalar(1 / dist);
      const dot = dir.dot(this.tmpV);
      if (dot > bestDot) {
        bestDot = dot;
        bestDir = this.tmpV2.copy(this.tmpV);
      }
    }
    if (bestDir) {
      dir.lerp(bestDir, strength).normalize();
    }
  }

  private resolveHitscan(ownerId: string, origin: THREE.Vector3, dir: THREE.Vector3, damage: number, weapon: WeaponId) {
    let bestDist = weapon === 'laser' ? 280 : 400;
    let best: AIPilot | 'local' | null = null;

    // Rivals — larger hit sphere so dogfights read as fair
    for (const bot of this.bots) {
      if (!bot.state.alive) continue;
      if (bot.state.id === ownerId) continue;
      const d = this.rayHitSphere(origin, dir, bot.pawn.group.position, COMBAT.enemyHitscanRadius);
      if (d >= 0 && d < bestDist) {
        bestDist = d;
        best = bot;
      }
    }

    // Local player if AI shot
    if (ownerId !== this.net.localId && this.net.getLocal().alive) {
      const d = this.rayHitSphere(origin, dir, this.flight.position, COMBAT.localHitRadius);
      if (d >= 0 && d < bestDist) {
        bestDist = d;
        best = 'local';
      }
    }

    if (best === 'local') {
      this.applyDamageToLocal(damage, ownerId, weapon);
    } else if (best) {
      const hitPos = best.pawn.group.position.clone();
      hitPos.y += 1.5;
      const killed = best.takeDamage(damage);
      this.reportEnemyHit(ownerId, damage, hitPos, weapon, killed, best.state.id);
    }
  }

  /** Shared feedback when local (or anyone) damages a rival. */
  private reportEnemyHit(
    ownerId: string,
    damage: number,
    hitPos: THREE.Vector3,
    weapon: WeaponId,
    killed: boolean,
    victimId: string
  ) {
    const crit = damage >= 70 || weapon === 'rail' || weapon === 'torpedo';
    if (ownerId === this.net.localId) {
      this.hud.flashHit();
      this.dmgFloats.spawn(hitPos, damage, crit ? 'crit' : 'deal');
      this.effects.hitSpark(hitPos, crit ? 0xffe566 : 0x00f0ff);
      if (crit) this.audio.playCrit();
      else this.audio.playHitConfirm();
    }
    if (killed) this.onKill(ownerId, victimId, weapon, hitPos);
  }

  private rayHitSphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number): number {
    const oc = this.tmpV.copy(origin).sub(center);
    const b = oc.dot(dir);
    const c = oc.dot(oc) - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : -1;
  }

  private resolveProjectiles() {
    for (const p of this.weapons.pool) {
      if (!p.active) continue;

      // Building / ground
      if (this.map.city.collideSphere(p.position, 0.4, this.collNormal) || p.position.y < 0.5) {
        this.detonateProjectile(p);
        continue;
      }

      // Rivals — forgiving projectile radius (homing rockets + fat sphere)
      const enemyR = COMBAT.enemyHitRadius + (p.weapon === 'rocket' || p.weapon === 'torpedo' ? 0.35 : 0);
      for (const bot of this.bots) {
        if (!bot.state.alive || bot.state.id === p.ownerId) continue;
        if (bot.pawn.group.position.distanceTo(p.position) < enemyR) {
          this.detonateProjectile(p, bot);
          break;
        }
      }
      if (!p.active) continue;

      // Local
      if (p.ownerId !== this.net.localId && this.net.getLocal().alive) {
        if (this.flight.position.distanceTo(p.position) < COMBAT.localHitRadius) {
          this.detonateProjectile(p, 'local');
        }
      }
    }
  }

  private detonateProjectile(
    p: import('./weapons/WeaponSystem').Projectile,
    direct?: AIPilot | 'local'
  ) {
    const pos = p.position.clone();
    const weapon = p.weapon;
    const owner = p.ownerId;
    const splash = p.splash;
    const damage = p.damage;
    const selfScale = p.selfDamageScale;
    this.weapons.deactivate(p);
    const boomColor =
      weapon === 'rocket' || weapon === 'torpedo' ? 0xff6622 : weapon === 'scatter' ? 0xffe566 : 0x00f0ff;
    this.effects.explode(pos, splash > 0 ? 2.2 : 1.1, boomColor);
    this.audio.playExplosion();

    const applySplash = (target: AIPilot | 'local', dist: number) => {
      let dmg = damage;
      if (splash > 0) {
        const fall = 1 - THREE.MathUtils.clamp(dist / splash, 0, 1);
        dmg = damage * fall;
      }
      if (dmg < 1) return;
      if (target === 'local') {
        if (owner === this.net.localId) dmg *= selfScale;
        if (dmg > 0) this.applyDamageToLocal(dmg, owner, weapon);
      } else {
        if (owner === target.state.id) dmg *= selfScale;
        if (dmg <= 0) return;
        const hitPos = target.pawn.group.position.clone();
        hitPos.y += 1.5;
        const killed = target.takeDamage(dmg);
        this.reportEnemyHit(owner, dmg, hitPos, weapon, killed, target.state.id);
      }
    };

    if (direct) {
      applySplash(direct, 0);
    }

    if (splash > 0) {
      for (const bot of this.bots) {
        if (!bot.state.alive) continue;
        if (direct && direct !== 'local' && bot === direct) continue;
        const dist = bot.pawn.group.position.distanceTo(pos);
        if (dist < splash) applySplash(bot, dist);
      }
      if (this.net.getLocal().alive && !(direct === 'local')) {
        const dist = this.flight.position.distanceTo(pos);
        if (dist < splash) applySplash('local', dist);
      }
    }
  }

  private applyDamageToLocal(amount: number, sourceId: string, weapon: WeaponId = 'plasma') {
    if (this.dead) return;
    const beforeShield = this.shield.charge;
    const deployed = this.shield.deployed;
    const left = this.shield.absorb(amount);
    const absorbed = amount - left;
    const local = this.net.getLocal();
    local.health = Math.max(0, local.health - left);
    local.shield = this.shield.charge;
    local.shieldDeployed = this.shield.deployed;
    this.hud.flashDamage();

    const floatPos = this.flight.position.clone();
    floatPos.y += 1.2;
    floatPos.x += (Math.random() - 0.5) * 2;
    if (left > 0.5) {
      this.dmgFloats.spawn(floatPos, left, 'take');
      this.audio.playHit();
      this.effects.hitSpark(floatPos, 0xff2bd6);
    } else if (absorbed > 0.5 || deployed || beforeShield > this.shield.charge) {
      this.dmgFloats.spawn(floatPos, Math.max(absorbed, amount * 0.3), 'shield');
      this.audio.playShieldHit();
    }

    if (local.health <= 0) {
      this.onLocalDeath(sourceId, weapon);
    }
  }

  private onLocalDeath(killerId: string, weapon: WeaponId) {
    const local = this.net.getLocal();
    local.alive = false;
    local.deaths++;
    this.dead = true;
    this.respawnTimer = COMBAT.respawnDelay;
    this.effects.explode(this.flight.position.clone(), 3, 0xff2bd6);
    this.audio.playDeath();
    this.localPawn.group.visible = false;

    const killer = this.net.getPlayers().find((p) => p.id === killerId);
    const killerName = killer?.callsign ?? (killerId === 'world' ? 'CITY' : 'UNKNOWN');
    this.hud.pushKill(killerName, local.callsign, WEAPONS[weapon]?.name ?? weapon);
    if (killer && killerId !== this.net.localId) {
      killer.kills++;
      killer.score += 100;
    }

    if (this.mode === 'outlaw') {
      this.lives--;
      if (this.lives <= 0) {
        this.endOutlaw(false);
      }
    }
  }

  private onKill(killerId: string, victimId: string, weapon: WeaponId, pos: THREE.Vector3) {
    this.effects.explode(pos.clone(), 2.5, 0xff2bd6);
    this.audio.playExplosion();
    const killer = this.net.getPlayers().find((p) => p.id === killerId);
    const victim = this.net.getPlayers().find((p) => p.id === victimId);
    this.hud.pushKill(killer?.callsign ?? '???', victim?.callsign ?? '???', WEAPONS[weapon]?.name ?? weapon);

    if (killerId === this.net.localId) {
      this.dmgFloats.spawn(pos.clone().add(new THREE.Vector3(0, 2, 0)), 0, 'kill');
      this.audio.playKill();
      const local = this.net.getLocal();
      local.kills++;
      local.score += 100;
      if (this.mode === 'outlaw') {
        this.outlawKills++;
      }
    }

    // Respawn rival after delay (keeps sky populated in FFA / roam)
    const bot = this.bots.find((b) => b.state.id === victimId);
    if (bot) {
      setTimeout(() => {
        if (!this.playing) return;
        if (this.mode === 'outlaw') {
          const aliveBots = this.bots.filter((b) => b.state.alive).length;
          if (aliveBots === 0 && this.outlawKills >= this.outlawKillsNeeded) {
            this.nextOutlawRound();
          }
        } else {
          bot.respawn(this.map.randomSpawn());
          this.ensureRivalPopulation();
        }
      }, COMBAT.respawnDelay * 1000);
    }
  }

  private doRespawn() {
    if (this.mode === 'outlaw' && this.lives <= 0) return;
    const spawn = this.map.randomSpawn();
    this.flight.reset(spawn);
    this.shield.reset();
    this.weapons.refill();
    this.dead = false;
    this.respawnTimer = -1;
    this.hud.showDeath(false);
    this.localPawn.group.visible = true;
    this.net.pushLocal({
      alive: true,
      health: COMBAT.maxHealth,
      shield: COMBAT.maxShield,
      shieldDeployed: false,
    });
  }

  private updateBots(dt: number) {
    const players = this.net.getPlayers();
    for (const bot of this.bots) {
      bot.update(dt, players, this.map.def.bounds, this.map.def.minAlt, this.map.def.maxAlt, (origin, dir, weapon) => {
        // Temporary switch weapon defs for NPC shot (don't drain player ammo)
        const prev = this.weapons.current;
        this.weapons.unlocked.add(weapon);
        this.weapons.select(weapon);
        const ammo = this.weapons.ammo[weapon];
        this.weapons.ammo[weapon] = weapon === 'plasma' ? -1 : 99;
        const cd = (this.weapons as unknown as { cooldown: number }).cooldown;
        (this.weapons as unknown as { cooldown: number }).cooldown = 0;
        // AI: soft auto-lock on their current chase target for rockets
        const result = this.weapons.fire(bot.state.id, origin, dir, {
          lockTargetId:
            weapon === 'rocket' || weapon === 'torpedo' ? bot.targetId : null,
          requireLock: false,
        });
        (this.weapons as unknown as { cooldown: number }).cooldown = cd;
        this.weapons.ammo[weapon] = ammo;
        this.weapons.select(prev);
        if (result?.hitscan) {
          for (const h of result.hitscan) {
            this.resolveHitscan(bot.state.id, origin, dir, h.damage, weapon);
          }
        }
      });
      // Solid building collision — multi-pass depenetration (no fly-through)
      const bpos = bot.pawn.group.position;
      for (let iter = 0; iter < 5; iter++) {
        if (!this.map.city.resolveSolid(bpos, 1.7, this.collNormal, 3)) break;
        bot.deflect(this.collNormal);
      }
      bot.writeState();

      // Hide ring/tracker when behind buildings (no wall-hacks)
      if (bot.state.alive) {
        const visible = this.map.city.lineOfSight(this.camera.position, bot.pawn.group.position);
        bot.setTrackerVisible(visible);
        // Body still depth-tests; if fully occluded, skip drawing ship too for clarity
        bot.pawn.group.visible = true;
        bot.pawn.body.visible = visible;
        bot.pawn.shieldMesh.visible = visible && bot.state.shieldDeployed;
      } else {
        bot.setTrackerVisible(false);
      }
    }
  }

  private syncLocalState() {
    const q = this.flight.quaternion;
    this.net.pushLocal({
      position: this.flight.position.toArray() as [number, number, number],
      rotation: [q.x, q.y, q.z, q.w],
      velocity: this.flight.velocity.toArray() as [number, number, number],
      health: this.net.getLocal().health,
      shield: this.shield.charge,
      shieldDeployed: this.shield.deployed,
      weapon: this.weapons.current,
      alive: !this.dead,
    });
  }

  private updateModeLogic() {
    if (this.mode === 'multiplayer' && this.matchLimit > 0 && this.matchTime >= this.matchLimit) {
      this.endMultiplayer();
    }
    if (this.mode === 'outlaw' && this.matchLimit > 0 && this.matchTime >= this.matchLimit) {
      // Time up for round
      if (this.outlawKills >= this.outlawKillsNeeded) this.nextOutlawRound();
      else this.endOutlaw(false);
    }
  }

  private nextOutlawRound() {
    this.outlawRound++;
    if (this.outlawRound >= OUTLAW.rounds) {
      this.endOutlaw(true);
      return;
    }
    this.outlawKills = 0;
    this.outlawKillsNeeded = OUTLAW.targetsPerRound[this.outlawRound] ?? 6;
    this.matchTime = 0;
    this.matchLimit = OUTLAW.roundTime;
    this.net.spawnBots(this.outlawKillsNeeded, false);
    this.spawnBotPawns();
    this.hud.setModeBanner(`OUTLAW HUNT · ROUND ${this.outlawRound + 1}/${OUTLAW.rounds}`);
    this.weapons.refill();
  }

  private endOutlaw(success: boolean) {
    this.playing = false;
    this.input.disengage();
    this.hud.show(false);
    const local = this.net.getLocal();
    const timeBonus = Math.floor(Math.max(0, this.matchLimit - this.matchTime) * OUTLAW.timeBonusPerSec);
    this.results.showResults(success ? 'BOUNTY COMPLETE' : 'HUNT FAILED', [
      `CALLSIGN  ${local.callsign}`,
      `KILLS  ${local.kills}`,
      `DEATHS  ${local.deaths}`,
      `SCORE  ${local.score + (success ? timeBonus : 0)}`,
      `LIVES LEFT  ${Math.max(0, this.lives)}`,
      success ? `TIME BONUS  +${timeBonus}` : 'OUT OF TIME OR LIVES',
    ]);
  }

  private endMultiplayer() {
    this.playing = false;
    this.input.disengage();
    this.hud.show(false);
    const sorted = [...this.net.getPlayers()].sort((a, b) => b.score - a.score);
    const local = this.net.getLocal();
    const rank = sorted.findIndex((p) => p.id === local.id) + 1;
    this.results.showResults('MATCH OVER', [
      `RANK  #${rank}`,
      `CALLSIGN  ${local.callsign}`,
      `KILLS  ${local.kills}`,
      `DEATHS  ${local.deaths}`,
      `SCORE  ${local.score}`,
    ]);
  }

  private updateHud(_dt: number) {
    const local = this.net.getLocal();
    const timeDisplay =
      this.matchLimit > 0 ? Math.max(0, this.matchLimit - this.matchTime) : this.matchTime;

    this.hud.updateFlight(
      this.flight.position.y,
      this.flight.speed,
      timeDisplay,
      this.flight.energy,
      local.health,
      this.shield.charge,
      this.shield.fullyCharged
    );
    this.hud.updateWeapon(this.weapons.current, this.weapons.ammo[this.weapons.current]);
    this.hud.updateLeaders(this.net.getPlayers(), this.net.localId);

    // Radar: only blip rivals with line-of-sight (no tracking through towers)
    const blips: Array<{ x: number; z: number; friendly: boolean; isPlayer?: boolean }> = [];
    for (const p of this.net.getPlayers()) {
      if (p.id === local.id) {
        blips.push({
          x: p.position[0],
          z: p.position[2],
          friendly: true,
          isPlayer: true,
        });
        continue;
      }
      if (!p.alive) continue;
      this.tmpV.set(p.position[0], p.position[1], p.position[2]);
      if (!this.map.city.lineOfSight(this.camera.position, this.tmpV)) continue;
      blips.push({
        x: p.position[0],
        z: p.position[2],
        friendly: p.team !== 0 && p.team === local.team,
        isPlayer: false,
      });
    }
    // Portal + crate markers on radar
    for (const p of this.map.portals.blips()) {
      blips.push({ x: p.x, z: p.z, friendly: true, isPlayer: false });
    }
    for (const p of this.pickups.blips()) {
      blips.push({ x: p.x, z: p.z, friendly: true, isPlayer: false });
    }
    this.hud.drawRadar(
      { x: this.flight.position.x, z: this.flight.position.z },
      this.flight.euler.y,
      blips,
      this.map.def.bounds * 0.6
    );

    if (this.hud.isDebugVisible()) {
      const info = this.renderer.info;
      const pos = this.flight.position;
      const moods = this.bots
        .filter((b) => b.state.alive)
        .map((b) => b.mood[0])
        .join('');
      this.hud.updateDebug([
        'Neon Veil  DEBUG  [F3]',
        `FPS        ${this.fps.toFixed(1)}`,
        `BIOME      ${this.map.def.name} (${this.mapId})`,
        `POS        ${pos.x.toFixed(1)}  ${pos.y.toFixed(1)}  ${pos.z.toFixed(1)}`,
        `SPEED      ${this.flight.speed.toFixed(1)} m/s`,
        `WEAPON     ${this.weapons.current}  ammo=${this.weapons.ammo[this.weapons.current]}`,
        `M-LOCK     ${this.missileLock.phase}  ${(this.missileLock.progress * 100).toFixed(0)}%  tgt=${this.missileLock.targetId ?? '-'}`,
        `BUILDINGS  ${this.map.city.buildingCount}`,
        `COLLIDERS  ${this.map.city.colliders.length}`,
        `PORTALS    ${this.map.portals.portals.length}`,
        `CRATES     ${this.pickups.pickups.filter((p) => p.alive).length}`,
        `DRAW CALLS ${info.render.calls}`,
        `TRIANGLES  ${info.render.triangles}`,
        `SECTOR     ${this.mapId}  instances=${this.biomeInstances.size + 1}`,
        `RIVALS     ${this.bots.filter((b) => b.state.alive).length}  moods=${moods || '-'}`,
        `ENGAGED    ${this.input.engaged ? 'yes' : 'no'}  lock=${this.input.pointerLocked ? 'yes' : 'no'}`,
        `PIXEL RATIO ${this.renderer.getPixelRatio().toFixed(2)}`,
      ]);
    }
  }

  private render() {
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);

    if (this.playing) {
      this.frame++;
      // Side mirrors every other frame (perf)
      if (this.frame % 2 === 0) this.renderMirrors();
    }
  }

  private renderMirrors() {
    // Left / right rear-ish views
    const pos = this.flight.position;
    const e = this.flight.euler;

    this.mirrorLeftCam.position.copy(pos);
    this.mirrorLeftCam.position.y += 0.3;
    this.mirrorLeftCam.quaternion.setFromEuler(new THREE.Euler(0, e.y + Math.PI * 0.75, 0, 'YXZ'));

    this.mirrorRightCam.position.copy(pos);
    this.mirrorRightCam.position.y += 0.3;
    this.mirrorRightCam.quaternion.setFromEuler(new THREE.Euler(0, e.y - Math.PI * 0.75, 0, 'YXZ'));

    // Hide local hood clutter for mirrors — body already hidden
    this.renderer.setRenderTarget(this.mirrorLeftRT);
    this.renderer.render(this.scene, this.mirrorLeftCam);
    this.renderer.setRenderTarget(this.mirrorRightRT);
    this.renderer.render(this.scene, this.mirrorRightCam);
    this.renderer.setRenderTarget(null);

    this.blitRT(this.mirrorLeftRT, this.mirrorLeftCtx);
    this.blitRT(this.mirrorRightRT, this.mirrorRightCtx);
  }

  private blitRT(rt: THREE.WebGLRenderTarget, ctx: CanvasRenderingContext2D) {
    try {
      this.renderer.readRenderTargetPixels(rt, 0, 0, 128, 96, this.mirrorBuf);
      const img = ctx.createImageData(128, 96);
      // Flip Y
      for (let y = 0; y < 96; y++) {
        for (let x = 0; x < 128; x++) {
          const src = ((95 - y) * 128 + x) * 4;
          const dst = (y * 128 + x) * 4;
          img.data[dst] = this.mirrorBuf[src];
          img.data[dst + 1] = this.mirrorBuf[src + 1];
          img.data[dst + 2] = this.mirrorBuf[src + 2];
          img.data[dst + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    } catch {
      /* WebGL read may fail on some contexts — ignore */
    }
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function nextFrame() {
  return new Promise<void>((r) => requestAnimationFrame(() => r()));
}
