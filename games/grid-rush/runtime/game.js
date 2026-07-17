import * as THREE from 'three';
import {
  AI_COLORS,
  AI_NAMES,
  CIRCUIT_MUSIC,
  ITEMS,
  LAPS,
  MENU_MUSIC,
  PHYSICS,
  RIVAL_COUNT,
  TRACK_HALF_WIDTH,
  TRACKS,
  VEHICLES,
} from './config.js';
import { RaceAudio } from './audio.js';
import { RaceFX } from './fx.js';
import { ItemWorld, rollItem, useItem, applyStun } from './items.js';
import { clamp, formatTime, lerp, ordinal, wrapAngle } from './math.js';
import { Track } from './track.js';
import { buildVehicleMesh, setBoostVisual } from './vehicles.js';
import { installSettings } from './settings.js';
import { createGrandPrix } from './modes/grand-prix.js';
import { createTimeTrial } from './modes/time-trial.js';

class Racer {
  constructor(id, callsign, vehicleId, isPlayer) {
    this.id = id;
    this.callsign = callsign;
    this.isPlayer = isPlayer;
    this.vehicle = VEHICLES[vehicleId] || VEHICLES.prism;
    this.mesh = buildVehicleMesh(this.vehicle);
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.trackS = 0;
    this.lateral = 0;
    this.lap = 1;
    this.cpIndex = 0;
    this.finished = false;
    this.finishTime = 0;
    this.alive = true;
    this.turbine = 40;
    this.drifting = false;
    this.driftDir = 0;
    this.item = null;
    this.itemCooldown = 0;
    this.stun = 0;
    this.phasing = false;
    this.phaseTimer = 0;
    this.veil = false;
    this.veilTimer = 0;
    this.overclockTimer = 0;
    this.steerInvert = 0;
    this.speedMul = 1;
    this.progress = 0;
    this.skill = 1;
    this.onTrack = true;
    this._lastS = 0;
    this._sparkT = 0;
    this._trailT = 0;
    this._bumpT = 0;
    // Jump + hazard recovery
    this.vy = 0;
    this.hopY = 0;
    this.airborne = false;
    this.hopCd = 0;
    this.hazardIFrames = 0;
    this.stuckT = 0;
  }
}

export class GridRushGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 6000);
    this.clock = new THREE.Clock();
    this.ambient = new THREE.AmbientLight(0x3a2260, 0.75);
    this.sun = new THREE.DirectionalLight(0xffaa88, 1.25);
    this.sun.position.set(50, 90, 30);
    this.hemi = new THREE.HemisphereLight(0x6688cc, 0x220811, 0.45);
    this.scene.add(this.ambient, this.sun, this.hemi);

    this.rim = new THREE.PointLight(0x00f0ff, 0.55, 220, 2);
    this.rim.position.set(0, 40, 0);
    this.scene.add(this.rim);

    this.keys = new Set();
    this.mouseDown = new Set();
    this.track = null;
    this.itemWorld = new ItemWorld(this.scene);
    this.fx = new RaceFX(this.scene);
    this.sfx = new RaceAudio();
    this.racers = [];
    this.player = null;
    this.phase = 'menu';
    this.mode = null; // active game mode (Grand Prix etc.); null = single race
    this.playing = false;
    this.paused = false;
    this.countdown = 0;
    this._lastCount = 4;
    this.raceTime = 0;
    this.trackId = 'prism_boulevard';
    this.vehicleId = 'prism';
    this.callsign = 'PILOT';
    this.finishedOrder = [];
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.music = null;
    this.time = 0;
    this._spaceWasDown = false;
    this._mouseX = (typeof innerWidth === 'number' ? innerWidth : 1280) / 2;
    this._cruising = false;
    this._cruiseAnchorX = 0;
    this.settings = null; // set by installSettings()

    this.els = {
      menu: document.getElementById('menu'),
      hud: document.getElementById('hud'),
      pause: document.getElementById('pause'),
      results: document.getElementById('results'),
      resultsTitle: document.getElementById('results-title'),
      resultsStats: document.getElementById('results-stats'),
      banner: document.getElementById('mode-banner'),
      countdown: document.getElementById('countdown'),
      toast: document.getElementById('race-toast'),
      pos: document.getElementById('hud-pos'),
      lap: document.getElementById('hud-lap'),
      speed: document.getElementById('hud-speed'),
      time: document.getElementById('hud-time'),
      leaders: document.getElementById('hud-leaders'),
      item: document.getElementById('hud-item'),
      itemName: document.getElementById('hud-item-name'),
      turbine: document.getElementById('bar-turbine'),
      turbineN: document.getElementById('bar-turbine-n'),
      callsign: document.getElementById('callsign'),
      minimap: document.getElementById('minimap'),
      vStats: document.getElementById('vehicle-stats'),
      circuitName: document.getElementById('circuit-name'),
      circuitBlurb: document.getElementById('circuit-blurb'),
      chassisName: document.getElementById('chassis-name'),
      metaCircuit: document.getElementById('meta-circuit'),
      metaChassis: document.getElementById('meta-chassis'),
      chassisPreview: document.getElementById('chassis-preview'),
    };
    this.minimapCtx = this.els.minimap?.getContext('2d') || null;

    this.initChassisPreview();
    installSettings(this); // sets this.settings (live values object)
    this.applyGraphics(this.settings.graphics);
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.applyVolume();
    this.bindUI();
    this.drawAllCircuitMaps();
    this.refreshSelectionUI();

    window.addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.resizeChassisPreview();
    });
    this.wirePauseShell();
    this.wireMute();
    this._wireMenuAudio();
    this.animate();
  }

  initChassisPreview() {
    const canvas = this.els.chassisPreview;
    if (!canvas) {
      this.preview = null;
      return;
    }
    this.preview = {
      renderer: new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      }),
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(42, 1, 0.1, 40),
      mesh: null,
      vehicleId: null,
    };
    this.preview.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.preview.renderer.setClearColor(0x000000, 0);
    this.preview.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.preview.scene.add(new THREE.AmbientLight(0x8899cc, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 6, 5);
    this.preview.scene.add(key);
    const fill = new THREE.PointLight(0x00f0ff, 0.7, 20);
    fill.position.set(-3, 2, 2);
    this.preview.scene.add(fill);
    const rim = new THREE.PointLight(0xff2bd6, 0.55, 18);
    rim.position.set(2, 1, -3);
    this.preview.scene.add(rim);
    // floor disc
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 40),
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.08,
        toneMapped: false,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.35;
    this.preview.scene.add(floor);
    this.preview.camera.position.set(0, 1.6, 6.2);
    this.preview.camera.lookAt(0, 0.35, 0);
    this.resizeChassisPreview();
    this.setChassisPreview(this.vehicleId);
  }

  resizeChassisPreview() {
    if (!this.preview || !this.els.chassisPreview) return;
    const canvas = this.els.chassisPreview;
    const w = canvas.clientWidth || 420;
    const h = canvas.clientHeight || 260;
    this.preview.renderer.setSize(w, h, false);
    this.preview.camera.aspect = w / Math.max(1, h);
    this.preview.camera.updateProjectionMatrix();
  }

  setChassisPreview(vehicleId) {
    if (!this.preview) return;
    const def = VEHICLES[vehicleId] || VEHICLES.prism;
    if (this.preview.mesh) {
      this.preview.scene.remove(this.preview.mesh);
      this.preview.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      this.preview.mesh = null;
    }
    const mesh = buildVehicleMesh(def);
    mesh.scale.setScalar(1.15);
    this.preview.scene.add(mesh);
    this.preview.mesh = mesh;
    this.preview.vehicleId = vehicleId;
  }

  renderChassisPreview(dt) {
    if (!this.preview?.mesh || this.phase !== 'menu') return;
    this.preview.mesh.rotation.y += dt * 0.85;
    this.preview.mesh.position.y = Math.sin(this.time * 1.6) * 0.08;
    this.preview.mesh.rotation.z = Math.sin(this.time * 1.1) * 0.04;
    setBoostVisual(this.preview.mesh, 0.35 + Math.sin(this.time * 3) * 0.15);
    this.preview.renderer.render(this.preview.scene, this.preview.camera);
  }

  /** Procedural circuit thumbnails from TRACKS params (no full Track needed). */
  drawAllCircuitMaps() {
    document.querySelectorAll('canvas.circuit-map[data-map]').forEach((cv) => {
      this.drawCircuitMap(cv, cv.dataset.map);
    });
  }

  drawCircuitMap(canvas, trackId) {
    const def = TRACKS[trackId];
    if (!def || !canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // bg
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `#${def.skyTop.toString(16).padStart(6, '0')}`);
    g.addColorStop(1, `#${def.skyBot.toString(16).padStart(6, '0')}`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const N = 64;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const r =
        def.radius *
        (0.82 + 0.18 * Math.sin(t * def.waves + def.seed * 0.01) + 0.06 * Math.sin(t * 5));
      const x = Math.cos(t) * r + Math.sin(t * 2) * (def.radius * 0.1);
      const z = Math.sin(t) * r * 0.72 + Math.cos(t * 3) * (def.radius * 0.07);
      pts.push({ x, z });
    }
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const pad = 10;
    const sc = Math.min((w - pad * 2) / (maxX - minX + 1e-6), (h - pad * 2) / (maxZ - minZ + 1e-6));
    const map = (p) => ({
      x: pad + (p.x - minX) * sc,
      y: pad + (p.z - minZ) * sc,
    });

    // road band
    ctx.strokeStyle = `#${def.rail.toString(16).padStart(6, '0')}55`;
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= pts.length; i++) {
      const p = map(pts[i % pts.length]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // rail centerline
    ctx.strokeStyle = `#${def.rail.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 2;
    ctx.shadowColor = `#${def.rail.toString(16).padStart(6, '0')}`;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = 0; i <= pts.length; i++) {
      const p = map(pts[i % pts.length]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // start mark
    const s0 = map(pts[0]);
    ctx.fillStyle = `#${def.accent.toString(16).padStart(6, '0')}`;
    ctx.beginPath();
    ctx.arc(s0.x, s0.y, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // height hint ticks
    ctx.fillStyle = `#${def.accent.toString(16).padStart(6, '0')}88`;
    for (let i = 0; i < 6; i++) {
      const p = map(pts[Math.floor((i / 6) * pts.length)]);
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
  }

  wireMute() {
    window.addEventListener('mutechange', (e) => {
      this.sfx.setMuted(!!e.detail?.muted);
      if (this.music) this.music.muted = !!e.detail?.muted;
    });
  }

  wirePauseShell() {
    window.__PAUSE__ = {
      toggle: () => {
        if (!this.playing || this.phase === 'menu' || this.phase === 'finished') return;
        if (this.paused) this.resume();
        else this.pause();
      },
      pause: () => {
        if (this.playing && !this.paused) this.pause();
      },
      resume: () => {
        if (this.playing && this.paused) this.resume();
      },
    };
  }

  bindUI() {
    const saved = localStorage.getItem('gridrush_callsign');
    if (saved && this.els.callsign) this.els.callsign.value = saved;

    document.querySelectorAll('[data-track]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-track]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.trackId = btn.dataset.track;
        this.refreshSelectionUI();
      });
    });
    document.querySelectorAll('[data-vehicle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-vehicle]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.vehicleId = btn.dataset.vehicle;
        this.setChassisPreview(this.vehicleId);
        this.refreshSelectionUI();
      });
    });

    document.getElementById('btn-start')?.addEventListener('click', () => {
      this.mode = null; // a normal launch clears any leftover cup
      this.sfx.resume();
      this.startRace();
    });
    document.getElementById('btn-grand-prix')?.addEventListener('click', () => {
      this.sfx.resume();
      this.mode = createGrandPrix();
      this.mode.setup(this); // seeds the 5-circuit cup; forces trackId to race 1
      this.startRace();
    });
    document.getElementById('btn-time-trial')?.addEventListener('click', () => {
      this.sfx.resume();
      this.mode = createTimeTrial(); // solo vs your ghost; onRaceStart runs inside startRace
      this.startRace();
    });
    document.getElementById('btn-resume')?.addEventListener('click', () => this.resume());
    document.getElementById('btn-quit')?.addEventListener('click', () => this.returnMenu());
    document.getElementById('btn-results-menu')?.addEventListener('click', () => this.returnMenu());
    document.getElementById('btn-results-retry')?.addEventListener('click', () => {
      this.els.results.classList.add('hidden');
      this.startRace();
    });

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'Escape' && this.playing && this.phase !== 'menu') {
        if (this.paused) this.resume();
        else this.pause();
      }
      if ((e.code === 'Enter' || e.code === 'Space') && this.paused) {
        e.preventDefault();
        this.resume();
      }
      if (e.code === 'KeyE' && this.playing && !this.paused) {
        this.tryUseItem(this.player);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => { this._mouseX = e.clientX; });
    window.addEventListener('mousedown', (e) => {
      this.mouseDown.add(e.button);
      if (e.button === 0 && this.playing && !this.paused) this.tryUseItem(this.player);
      if (e.button === 2) { this._cruising = true; this._cruiseAnchorX = e.clientX; } // RMB cruise-steer
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown.delete(e.button);
      if (e.button === 2) this._cruising = false;
    });
  }

  refreshSelectionUI() {
    const track = TRACKS[this.trackId] || TRACKS.prism_boulevard;
    const v = VEHICLES[this.vehicleId] || VEHICLES.prism;
    if (this.els.circuitName) this.els.circuitName.textContent = track.name;
    if (this.els.circuitBlurb) this.els.circuitBlurb.textContent = track.blurb;
    if (this.els.chassisName) this.els.chassisName.textContent = v.name;
    if (this.els.metaCircuit) this.els.metaCircuit.textContent = track.name;
    if (this.els.metaChassis) this.els.metaChassis.textContent = v.name;
    const blurb = document.getElementById('vehicle-blurb');
    if (blurb) blurb.textContent = v.blurb;
    this.renderVehicleStats(v);
  }

  renderVehicleStats(v) {
    const host = this.els.vStats;
    if (!host || !v) return;
    const rows = [
      ['SPEED', v.speed],
      ['ACCEL', v.accel],
      ['HANDLE', v.handle],
      ['WEIGHT', v.weight],
    ];
    host.innerHTML = rows
      .map(([label, val]) => {
        const pct = Math.round(clamp((val - 0.7) / 0.7, 0, 1) * 100);
        return `<div class="stat-row"><span>${label}</span><div class="stat-bar"><i style="width:${pct}%"></i></div><span class="stat-n">${val.toFixed(2)}</span></div>`;
      })
      .join('');
  }

  pause() {
    if (this.phase === 'finished') return;
    this.paused = true;
    this.els.pause?.classList.remove('hidden');
  }

  resume() {
    this.paused = false;
    this.els.pause?.classList.add('hidden');
  }

  clearRace() {
    this.mode?.teardown?.(this); // release mode-owned scene objects (e.g. TIME TRIAL ghost)
    if (this.track) {
      this.track.dispose();
      this.track = null;
    }
    this.itemWorld.clear();
    this.fx.clear();
    for (const r of this.racers) {
      this.scene.remove(r.mesh);
    }
    this.racers = [];
    this.player = null;
  }

  applyAtmosphere(def) {
    const c = new THREE.Color(def.skyTop);
    this.scene.background = c;
    // Fog scales with circuit size so a long track reads with depth (near clear,
    // far side fades out) instead of being either fully fogged or flatly clear.
    this.scene.fog = new THREE.Fog(def.fog, def.radius * 0.22, def.radius * 2.8);
    this.ambient.color.setHex(def.ambient);
    this.sun.color.setHex(def.sun);
    this.rim.color.setHex(def.rail);
  }

  startRace() {
    const cs = (this.els.callsign?.value.trim() || 'PILOT').slice(0, 16).toUpperCase();
    this.callsign = cs;
    localStorage.setItem('gridrush_callsign', cs);
    this.sfx.resume();
    this._hudCache = {}; // fresh HUD-write cache each race so nothing is skipped stale

    this.clearRace();
    const def = TRACKS[this.trackId] || TRACKS.prism_boulevard;
    this.track = new Track(this.scene, def);
    this.applyAtmosphere(def);

    const rivalCount = this.mode?.rivalCount ?? RIVAL_COUNT; // TIME TRIAL sets 0 (solo)
    const total = 1 + rivalCount;
    this.racers = [];
    const player = new Racer('local', cs, this.vehicleId, true);
    this.placeOnGrid(player, 0, total);
    this.player = player;
    this.racers.push(player);
    this.scene.add(player.mesh);

    for (let i = 0; i < rivalCount; i++) {
      const vids = Object.keys(VEHICLES);
      const vid = vids[(i + 1) % vids.length];
      const r = new Racer(`bot-${i}`, AI_NAMES[i % AI_NAMES.length], vid, false);
      r.skill = 0.78 + (i / Math.max(1, rivalCount)) * 0.28;
      const marker = new THREE.Mesh(
        new THREE.ConeGeometry(0.35, 0.7, 3),
        new THREE.MeshBasicMaterial({ color: AI_COLORS[i % AI_COLORS.length] })
      );
      marker.position.y = 2.4;
      marker.rotation.x = Math.PI;
      r.mesh.add(marker);
      this.placeOnGrid(r, i + 1, total);
      this.racers.push(r);
      this.scene.add(r.mesh);
    }

    this.finishedOrder = [];
    this._raceOver = false;
    this.raceTime = 0;
    this.phase = 'countdown';
    this.countdown = 3.4;
    this._lastCount = 4;
    this.playing = true;
    this.paused = false;
    this._spaceWasDown = false;
    this.els.menu?.classList.add('hidden');
    this.els.results?.classList.add('hidden');
    this.els.pause?.classList.add('hidden');
    this.els.hud?.classList.remove('hidden');
    if (this.els.banner) this.els.banner.textContent = `${def.name} · ${LAPS} LAPS · DATA ORBS LIVE`;
    this.mode?.onRaceStart?.(this); // per-race mode init (e.g. TIME TRIAL ghost); may override the banner
    this.playMusic();
    this.clock.start();
  }

  placeOnGrid(racer, index, total) {
    const pose = this.track.startPose(index, total);
    racer.position.copy(pose.pos);
    racer.trackS = pose.s;
    racer.lateral = pose.lateral;
    racer.yaw = Math.atan2(pose.tangent.x, pose.tangent.z);
    racer.velocity.set(0, 0, 0);
    racer.speed = 0;
    racer.lap = 1;
    racer.cpIndex = 1;
    racer.finished = false;
    racer.item = null;
    racer.turbine = 45;
    racer.stun = 0;
    racer.phasing = false;
    racer.veil = false;
    racer.overclockTimer = 0;
    racer.steerInvert = 0;
    racer.speedMul = 1;
    racer._lastS = pose.s;
    racer.vy = 0;
    racer.hopY = 0;
    racer.airborne = false;
    racer.hopCd = 0;
    racer.hazardIFrames = 0;
    racer.stuckT = 0;
    this.syncMesh(racer);
  }

  /** Swap to `src`; no-op (just re-sets volume) if it's already the playing track. */
  _setMusic(src, vol) {
    try {
      const scale = this.settings ? this.settings.masterVol * this.settings.musicVol : 1;
      this._musicBase = vol;
      if (this.music && this._musicSrc === src) {
        this.music.volume = vol * scale;
        if (this.music.paused) void this.music.play().catch(() => {});
        return;
      }
      if (this.music) {
        this.music.pause();
        this.music = null;
      }
      this._musicSrc = src;
      const a = new Audio(src);
      a.loop = true;
      a.volume = vol * scale;
      this.music = a;
      void a.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /** Push master×bus volumes into the SFX gain + current music element (settings sliders). */
  applyVolume() {
    const s = this.settings;
    if (!s) return;
    this.sfx.setMasterVolume(s.masterVol * s.sfxVol);
    if (this.music) this.music.volume = (this._musicBase ?? 0.3) * s.masterVol * s.musicVol;
  }

  /** Graphics preset — render resolution is the biggest perf lever (Low renders at
   *  75% and upscales; High caps DPR at 2). */
  applyGraphics(preset) {
    this._gfxPreset = preset;
    const dpr = preset === 'low' ? 0.75 : preset === 'medium' ? 1.25 : Math.min(devicePixelRatio || 1, 2);
    try {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(innerWidth, innerHeight);
    } catch (e) {}
  }

  /** Race music — each circuit has its OWN track (config CIRCUIT_MUSIC). */
  playMusic() {
    this._setMusic(CIRCUIT_MUSIC[this.trackId] || MENU_MUSIC, 0.32);
  }

  /** Chill menu bed (a touch quieter than race music). */
  playMenuMusic() {
    this._setMusic(MENU_MUSIC, 0.22);
  }

  /** Menu music can't autoplay before a user gesture; start it now and on first input. */
  _wireMenuAudio() {
    const kick = () => {
      this.sfx?.resume?.();
      if (this.phase === 'menu' && (!this.music || this.music.paused)) this.playMenuMusic();
    };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);
    this.playMenuMusic();
  }

  returnMenu() {
    this.playing = false;
    this.phase = 'menu';
    this.paused = false;
    this.clearRace(); // runs the active mode's teardown (e.g. TIME TRIAL ghost) FIRST…
    this.mode = null; // …then drop the mode, so teardown isn't skipped
    this.els.hud?.classList.add('hidden');
    this.els.pause?.classList.add('hidden');
    this.els.results?.classList.add('hidden');
    this.els.menu?.classList.remove('hidden');
    this.els.countdown?.classList.remove('show');
    this.scene.background = new THREE.Color(0x0a0618);
    this.scene.fog = null;
    this.playMenuMusic();
    this.resizeChassisPreview();
  }

  animate = () => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    if (this.playing && !this.paused) this.update(dt);
    else if (this.phase === 'menu') this.renderMenuIdle(dt);
    this.render();
  };

  renderMenuIdle(dt) {
    // Main canvas soft orbit; chassis preview rotates separately
    this.camera.position.set(Math.sin(this.time * 0.15) * 40, 22, Math.cos(this.time * 0.15) * 40);
    this.camera.lookAt(0, 4, 0);
    if (!this.scene.background) this.scene.background = new THREE.Color(0x0a0618);
    this.renderChassisPreview(dt);
  }

  update(dt) {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.els.countdown) {
        this.els.countdown.classList.add('show');
        const n = Math.ceil(this.countdown);
        this.els.countdown.textContent = n > 0 ? String(n) : 'RUSH';
        if (n !== this._lastCount && n > 0 && n <= 3) {
          this.sfx.countdown();
          this._lastCount = n;
        }
      }
      for (const r of this.racers) this.syncMesh(r);
      this.updateCamera(dt);
      this.updateHud();
      this.fx.update(dt);
      if (this.countdown <= 0) {
        this.phase = 'racing';
        this.els.countdown.classList.remove('show');
        this.sfx.go();
        this.flashToast('GRID OPEN');
      }
      return;
    }

    if (this.phase === 'racing' || this.phase === 'finished') {
      this.raceTime += dt;
      this.track.update(dt, this.time);
      this.updatePlayer(dt);
      this.updateAI(dt);
      this.resolveCollisions();
      for (const r of this.racers) {
        if (!r.finished) {
          this.checkCheckpoints(r);
          this.checkItemPads(r);
          this.checkHazards(r);
          this.unstickIfNeeded(r, dt);
        } else {
          this.syncMesh(r);
        }
      }
      this.itemWorld.update(dt, this.racers, (r) => {
        const res = applyStun(r, 1.0, 0.45);
        if (r.isPlayer && res === 'hit') {
          this.flashToast('HIT — PULSE MINE');
          this.sfx.hit();
          this.fx.addShake(0.55);
          this.fx.burst(r.position, 0xff6b2b, 16, 14);
        }
      });
      this.fx.update(dt);
      this.updateProgress();
      this.updateCamera(dt);
      this.updateHud();
      this.mode?.update?.(this, dt);
      this.drawMinimap();

      // Show results the MOMENT the player finishes; the AI keep racing behind
      // the overlay and their times fill in live. Freeze the world once everyone
      // is in (or after a grace period — remaining racers become DNF).
      if (this.phase === 'racing' && this.player?.finished) {
        this.endRace();
      }
      if (this.phase === 'finished') {
        if (
          this.finishedOrder.length >= this.racers.length ||
          this.raceTime - this.player.finishTime > 18
        ) {
          this._raceOver = true;
        }
        this.refreshResults();
        if (this._raceOver) {
          this.playing = false;
          this.mode?.checkEnd?.(this);
        }
      }
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    if (!p || p.finished) return;

    // Steering convention: +steer yaws the car screen-LEFT (verified via a
    // camera-space turn test), so A/Left = +1 and D/Right = -1.
    // W = throttle, S = brake/reverse, SPACE = jump.
    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let reverse = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) steer += 1; // left
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) steer -= 1; // right

    const s = this.settings;
    // Position-based mouse steer: cursor right of center → steer right (-).
    if (s?.mouseSteer && !this._cruising) {
      const half = innerWidth / 2;
      let norm = (this._mouseX - half) / half; // -1 far-left .. +1 far-right
      if (Math.abs(norm) < 0.06) norm = 0; // center deadzone
      steer += -norm * (s.mouseSens || 1);
    }
    // Right-click cruise: proportional to drag from the press anchor (mouse LEFT = +steer/left).
    if (this._cruising && s?.cruiseSteer) {
      steer += ((this._cruiseAnchorX - this._mouseX) / 240) * (s.mouseSens || 1);
    }
    if (s?.invertSteer) steer = -steer;
    steer = clamp(steer, -1, 1);

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle = 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
      // Going forward → brake; stopped/backward → reverse
      if (p.speed > 4 && p.velocity.dot(p.forward) > 0.5) brake = 1;
      else reverse = 1;
    }

    // SPACE = jump (edge-triggered)
    const space = this.keys.has('Space');
    let jump = false;
    if (space && !this._spaceWasDown) jump = true;
    this._spaceWasDown = space;

    const burst = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.driveRacer(p, dt, steer, throttle, brake, reverse, jump, burst);
  }

  updateAI(dt) {
    for (const r of this.racers) {
      if (r.isPlayer || r.finished) continue;
      const look = this.track.sampleAt(r.trackS + 18 + r.skill * 10);
      // Stay nearer center on wider road; dodge hazards via lateral target
      const idealLat = Math.sin(this.time * 0.7 + r.skill * 8) * (TRACK_HALF_WIDTH * 0.22 * (1.1 - r.skill));
      const hazardAvoid = this.aiHazardAvoid(r);
      const target = look.pos
        .clone()
        .addScaledVector(look.side, clamp(idealLat + hazardAvoid, -TRACK_HALF_WIDTH * 0.7, TRACK_HALF_WIDTH * 0.7));
      target.y = r.position.y;
      const to = this.tmp.copy(target).sub(r.position);
      const desiredYaw = Math.atan2(to.x, to.z);
      let dy = wrapAngle(desiredYaw - r.yaw);
      const steer = clamp(dy * 1.8, -1, 1);
      const throttle = 0.75 + r.skill * 0.3;
      // AI jump over nearby spinner sometimes
      let jump = false;
      if (!r.airborne && r.hopCd <= 0 && Math.random() < dt * 0.35) {
        for (const h of this.track.hazards) {
          if (h.type === 'spin' && r.position.distanceTo(h.mesh.position) < 6.5) {
            jump = true;
            break;
          }
        }
      }
      const place = this.placeOf(r);
      const burst = place > 3 && r.turbine > 30 && Math.sin(this.time * 2 + r.skill) > 0.3;
      this.driveRacer(r, dt, steer, throttle, 0, 0, jump, burst);
      if (r.item && r.itemCooldown <= 0 && Math.random() < dt * 0.55) {
        const offensive = ITEMS[r.item]?.offense;
        if (!offensive || place > 1 || Math.random() < 0.35) this.tryUseItem(r);
      }
    }
  }

  aiHazardAvoid(r) {
    let push = 0;
    for (const h of this.track.hazards) {
      const c = h.mesh.position;
      const d = r.position.distanceTo(c);
      if (d < h.radius + 6) {
        const samp = this.track.sampleAt(r.trackS);
        const lat = this.tmp.copy(c).sub(samp.pos).dot(samp.side);
        // Steer away from hazard lateral
        push += -Math.sign(lat || 1) * (1 - d / (h.radius + 6)) * 4;
      }
    }
    return clamp(push, -6, 6);
  }

  /**
   * @param jump - press jump this frame
   * @param reverse - reverse throttle 0..1
   */
  driveRacer(r, dt, steer, throttle, brake, reverse, jump, burst) {
    if (!r.alive) return;
    r.itemCooldown = Math.max(0, r.itemCooldown - dt);
    r.stun = Math.max(0, r.stun - dt);
    r._bumpT = Math.max(0, r._bumpT - dt);
    r.hopCd = Math.max(0, r.hopCd - dt);
    r.hazardIFrames = Math.max(0, r.hazardIFrames - dt);

    if (r.phaseTimer > 0) {
      r.phaseTimer -= dt;
      if (r.phaseTimer <= 0) {
        r.phasing = false;
        r.speedMul = 1;
      }
    }
    if (r.veilTimer > 0) {
      r.veilTimer -= dt;
      if (r.veilTimer <= 0) r.veil = false;
    }
    if (r.overclockTimer > 0) r.overclockTimer -= dt;
    r.steerInvert = Math.max(0, r.steerInvert - dt);

    // Jump impulse
    if (jump && !r.airborne && r.hopCd <= 0 && r.stun <= 0) {
      // Cap the weight divisor so even the heaviest chassis (Mag-Drill, 1.35)
      // reliably clears the hopY>1.4 hazard threshold at any frame rate.
      r.vy = PHYSICS.hopForce / Math.max(0.85, Math.min(1.2, r.vehicle.weight));
      r.airborne = true;
      r.hopCd = PHYSICS.hopCooldown;
      if (r.isPlayer) {
        this.sfx.drift();
        this.fx.sparks(r.position, r.forward, r.vehicle.color, 6);
      }
    }

    // Vertical hop integration (always, even during mild stun)
    if (r.airborne || r.hopY > 0) {
      r.vy -= PHYSICS.gravity * dt;
      r.hopY += r.vy * dt;
      if (r.hopY <= 0) {
        r.hopY = 0;
        r.vy = 0;
        r.airborne = false;
      }
    }

    if (r.stun > 0) {
      // Soft stun: still allow residual slide + recovery thrust along track
      r.velocity.multiplyScalar(Math.exp(-1.6 * dt));
      // Nudge along track so bots never freeze on a pillar
      const samp = this.track.sampleAt(r.trackS);
      r.velocity.addScaledVector(samp.tangent, 8 * dt);
      r.speed = r.velocity.length();
      r.position.addScaledVector(r.velocity, dt);
      this.projectRacer(r);
      this.syncMesh(r);
      return;
    }

    if (r.steerInvert > 0) steer *= -1;

    const v = r.vehicle;
    const maxSp = PHYSICS.maxSpeed * v.speed * r.speedMul * (r.overclockTimer > 0 ? 1.18 : 1);

    // Drift removed from Space — light auto-drift feel when steering hard at speed
    r.drifting = Math.abs(steer) > 0.85 && r.speed > 28 && throttle > 0.5;
    if (r.drifting) r.driftDir = Math.sign(steer) || r.driftDir;

    const steerRate =
      lerp(PHYSICS.steerBase, PHYSICS.steerHighSpeed, clamp(r.speed / maxSp, 0, 1)) *
      v.handle *
      (r.isPlayer ? (this.settings?.steerSens ?? 1) : 1) *
      (r.drifting ? PHYSICS.driftSteerMul : 1) *
      (r.airborne ? 0.55 : 1);
    // A = left (negative yaw), D = right (positive yaw) — matches camera chase
    r.yaw += steer * steerRate * dt;

    this.forwardFromYaw(r);
    const accel = PHYSICS.accel * v.accel * (throttle > 0 ? throttle : 0);
    r.velocity.addScaledVector(r.forward, accel * dt);

    if (brake > 0) {
      const brakeF = PHYSICS.brake * brake;
      r.velocity.addScaledVector(r.forward, -brakeF * dt * 0.4);
      r.velocity.multiplyScalar(Math.exp(-brakeF * 0.025 * dt));
    }

    if (reverse > 0) {
      r.velocity.addScaledVector(r.forward, -PHYSICS.reverseAccel * v.accel * reverse * dt);
    }

    const latVel = r.velocity.dot(r.right);
    const grip = r.drifting ? PHYSICS.driftGrip : PHYSICS.grip;
    // dt-normalized: lateral grip (drift/slide feel) is now identical at any
    // refresh rate. Equals `grip` exactly at 60fps so existing tuning is kept.
    const gripK = 1 - Math.pow(1 - grip, dt * 60);
    r.velocity.addScaledVector(r.right, -latVel * gripK);

    const wantBurst = burst && r.turbine > 2 && !r.airborne;
    const overclocking = r.overclockTimer > 0 && !r.airborne;
    const tMul = (r.vehicle && r.vehicle.turbineMul) || 1; // Nova Disc: wild turbine recovery
    if (wantBurst) {
      r.turbine = Math.max(0, r.turbine - PHYSICS.turbineDrain * dt);
      r.velocity.addScaledVector(r.forward, PHYSICS.accel * 0.85 * PHYSICS.burstMul * dt);
    } else if (overclocking) {
      // Overclock is a sustained boost: real forward thrust (no turbine cost)
      // toward the raised cap, so it feels like a boost, not just a higher limit.
      r.velocity.addScaledVector(r.forward, PHYSICS.accel * 0.7 * dt);
      r.turbine = Math.min(PHYSICS.turbineMax, r.turbine + PHYSICS.turbineRegen * 0.5 * dt * tMul);
    } else {
      r.turbine = Math.min(
        PHYSICS.turbineMax,
        r.turbine + (PHYSICS.turbineRegen * dt + (r.drifting ? PHYSICS.turbineDriftGain * dt : 0)) * tMul
      );
    }

    const place = this.placeOf(r);
    const rb =
      place >= this.racers.length - 1
        ? PHYSICS.rubberBandBehind
        : place <= 1
          ? PHYSICS.rubberBandLead
          : 1;
    r.velocity.multiplyScalar(Math.pow(PHYSICS.drag, dt * 60 * 0.016));
    r.velocity.multiplyScalar(1 - 0.35 * dt);

    // Cap reverse separately
    const along = r.velocity.dot(r.forward);
    if (along < -PHYSICS.reverseMax * v.speed) {
      r.velocity.addScaledVector(r.forward, -along - PHYSICS.reverseMax * v.speed);
    }

    r.speed = r.velocity.length();
    // SHIFT burst may briefly exceed the normal top speed (that's the point of a
    // boost); overclock's higher cap is already baked into maxSp.
    const boostCap = maxSp * (wantBurst ? PHYSICS.burstMul : 1);
    const cap = (r.onTrack === false ? PHYSICS.offTrackMax : boostCap) * rb;
    if (r.speed > cap && along > 0) {
      r.velocity.multiplyScalar(cap / r.speed);
      r.speed = cap;
    }

    r.position.addScaledVector(r.velocity, dt);
    this.projectRacer(r);

    r.roll = lerp(r.roll, -steer * (r.drifting ? 0.55 : 0.28), 1 - Math.exp(-8 * dt));
    this.syncMesh(r);
    setBoostVisual(r.mesh, wantBurst || r.overclockTimer > 0 ? 1 : r.speed / maxSp);

    if (r.drifting) {
      r._sparkT -= dt;
      if (r._sparkT <= 0) {
        r._sparkT = 0.05;
        this.fx.sparks(r.position, r.forward, r.vehicle.accent, 4);
      }
    }
    if (wantBurst || r.overclockTimer > 0) {
      r._trailT -= dt;
      if (r._trailT <= 0) {
        r._trailT = 0.04;
        this.fx.trail(r.position.clone().addScaledVector(r.forward, -1.2), r.vehicle.color);
      }
      if (r.isPlayer) this.sfx.thrusterLevel(wantBurst ? 1 : 0.6);
    }
    if (r.mesh.userData.glow) {
      r.mesh.userData.glow.material.opacity = r.phasing ? 0.42 : r.veil ? 0.28 : 0.12;
      r.mesh.userData.glow.material.color.setHex(r.phasing ? 0xaa66ff : r.vehicle.color);
    }
  }

  resolveCollisions() {
    const list = this.racers.filter((r) => r.alive && !r.finished && !r.phasing);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        // Jump over each other when airborne height differs
        if (Math.abs(a.hopY - b.hopY) > 1.2) continue;
        const d = a.position.distanceTo(b.position);
        const min = 2.4;
        if (d >= min || d < 1e-4) continue;
        const n = this.tmp.copy(a.position).sub(b.position);
        n.y = 0; // keep bumps horizontal — no injected vertical velocity on slopes
        if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
        n.normalize();
        // ALWAYS depenetrate positionally so packs of 3+ karts can't interpenetrate
        // and pile up; the bump cooldown below only gates the bounce impulse.
        const push = (min - d) * 0.5;
        a.position.addScaledVector(n, push);
        b.position.addScaledVector(n, -push);
        if (a._bumpT > 0 || b._bumpT > 0) continue;
        const wa = a.vehicle.weight;
        const wb = b.vehicle.weight;
        const rel = this.tmp2.copy(a.velocity).sub(b.velocity);
        const along = rel.dot(n);
        if (along < 0) {
          const impulse = (-along * 0.55) / (wa + wb);
          a.velocity.addScaledVector(n, impulse * wb);
          b.velocity.addScaledVector(n, -impulse * wa);
          a.speed = a.velocity.length();
          b.speed = b.velocity.length();
        }
        a._bumpT = 0.12;
        b._bumpT = 0.12;
        if (a.isPlayer || b.isPlayer) {
          this.fx.burst(a.position.clone().lerp(b.position, 0.5), 0x00f0ff, 8, 8);
          this.fx.addShake(0.18);
        }
      }
    }
  }

  forwardFromYaw(r) {
    // yaw 0 → +Z; +yaw → turn right toward +X
    r.forward.set(Math.sin(r.yaw), 0, Math.cos(r.yaw));
    r.right.set(Math.cos(r.yaw), 0, -Math.sin(r.yaw));
  }

  projectRacer(r) {
    const proj = this.track.project(r.position);
    let ds = proj.s - r._lastS;
    const L = this.track.totalLength;
    if (ds > L * 0.5) ds -= L;
    if (ds < -L * 0.5) ds += L;
    r.trackS += ds;
    r._lastS = proj.s;
    r.lateral = proj.lateral;
    r.onTrack = proj.onTrack;

    const samp = this.track.sampleAt(proj.s);
    r.position.y = samp.pos.y + PHYSICS.hoverHeight + r.hopY;

    const lim = TRACK_HALF_WIDTH + 0.8;
    if (Math.abs(r.lateral) > lim) {
      const over = Math.abs(r.lateral) - lim;
      const sign = Math.sign(r.lateral);
      r.position.addScaledVector(samp.side, -sign * over * 0.85);
      const vn = r.velocity.dot(samp.side) * sign;
      if (vn > 0) r.velocity.addScaledVector(samp.side, -vn * 1.2);
      r.velocity.multiplyScalar(0.82);
      r.lateral = clamp(r.lateral, -lim, lim);
      r.onTrack = false;
    }
  }

  checkCheckpoints(r) {
    const cps = this.track.checkpoints;
    const next = cps[r.cpIndex % cps.length];
    if (!next) return;
    const d = r.position.distanceTo(next.pos);
    if (d < TRACK_HALF_WIDTH + 6) {
      const along = this.tmp.copy(r.position).sub(next.pos).dot(next.tangent);
      if (along > -4 && along < 10) {
        r.cpIndex++;
        if (r.cpIndex >= cps.length) {
          r.cpIndex = 0;
          r.lap++;
          if (r.lap > LAPS) {
            r.finished = true;
            r.finishTime = this.raceTime;
            r.lap = LAPS;
            if (!this.finishedOrder.includes(r.id)) this.finishedOrder.push(r.id);
            this.mode?.onRacerFinish?.(this, r);
            if (r.isPlayer) {
              this.flashToast('FINISH!');
              this.sfx.finish();
              this.fx.burst(r.position, 0x39ff88, 24, 16);
            }
          } else if (r.isPlayer) {
            this.flashToast(`LAP ${r.lap}/${LAPS}`);
            this.sfx.checkpoint();
          }
        } else if (r.isPlayer) {
          this.sfx.checkpoint();
        }
      }
    }
  }

  checkItemPads(r) {
    if (r.item) return;
    for (const pad of this.track.itemPads) {
      if (!pad.alive) continue;
      if (r.position.distanceTo(pad.pos) < 2.8) {
        pad.alive = false;
        pad.respawn = 7;
        pad.mesh.visible = false;
        r.item = rollItem(this.placeOf(r), this.racers.length);
        if (r.isPlayer) {
          this.flashToast(`DATA ORB · ${ITEMS[r.item]?.name || 'GADGET'}`);
          this.sfx.pickup();
          this.fx.burst(pad.pos, 0xaa66ff, 12, 10);
        }
        break;
      }
    }
  }

  checkHazards(r) {
    if (r.phasing) return;
    if (r.hazardIFrames > 0) return;
    // Jump clears low hazards
    if (r.hopY > 1.4) return;

    for (const h of this.track.hazards) {
      const c = h.mesh.position;
      if (h.type === 'spin') {
        // Rotation-accurate: hit only near the actual spinning bar, not anywhere
        // in a static disc. Perpendicular distance to the current bar segment.
        const th = h.mesh.rotation.y;
        const halfLen = h.len ? h.len * 0.5 : h.radius;
        const bx = Math.cos(th), bz = -Math.sin(th);
        const px = r.position.x - c.x, pz = r.position.z - c.z;
        const t = clamp(px * bx + pz * bz, -halfLen, halfLen);
        const ox = px - bx * t, oz = pz - bz * t;
        if (ox * ox + oz * oz >= 2.6 * 2.6) continue;
      } else if (r.position.distanceTo(c) >= h.radius) {
        continue;
      }

      // i-frames first so continuous overlap cannot re-stun forever
      r.hazardIFrames = PHYSICS.hazardIFrames;

      const res = applyStun(r, PHYSICS.hazardStun, 0.22, true);
      // Knock away from hazard + along track so there's always a way out
      const n = this.tmp.copy(r.position).sub(c);
      if (n.lengthSq() < 1e-4) n.copy(r.forward);
      n.y = 0;
      n.normalize();
      const samp = this.track.sampleAt(r.trackS);
      const knock = PHYSICS.hazardKnock * (h.knock || 1);
      r.velocity.set(0, 0, 0);
      r.velocity.addScaledVector(n, knock * 0.55);
      r.velocity.addScaledVector(samp.tangent, knock * 0.55);
      r.speed = r.velocity.length();
      // Pop FULLY outside the collider (not a fixed nudge) so a stunned kart
      // can't re-settle inside a large hazard and get wedged there.
      const dh = Math.hypot(r.position.x - c.x, r.position.z - c.z);
      r.position.addScaledVector(n, Math.max(0.8, h.radius - dh) + 1.2);
      r.position.addScaledVector(samp.tangent, 1.2);

      if (r.isPlayer && res === 'hit') {
        this.flashToast('HAZARD IMPACT');
        this.sfx.hit();
        this.fx.addShake(0.4);
        this.fx.burst(r.position, 0xff2bd6, 10, 10);
      }
      break;
    }
  }

  /** Emergency unstick if velocity near zero while overlapping hazards / walls */
  unstickIfNeeded(r, dt) {
    if (r.finished || r.phasing) return;
    const slow = r.speed < 3.5;
    let nearHazard = false;
    if (this.track) {
      for (const h of this.track.hazards) {
        if (r.position.distanceTo(h.mesh.position) < h.radius + 0.6) {
          nearHazard = true;
          break;
        }
      }
    }
    if (slow && nearHazard) r.stuckT += dt;
    else r.stuckT = Math.max(0, r.stuckT - dt * 0.5);

    if (r.stuckT > 0.45) {
      r.stuckT = 0;
      r.stun = 0;
      r.hazardIFrames = PHYSICS.hazardIFrames;
      const samp = this.track.sampleAt(r.trackS);
      // Snap toward centerline and shove forward
      const center = samp.pos.clone();
      center.y = r.position.y;
      r.position.lerp(center, 0.65);
      r.velocity.copy(samp.tangent).multiplyScalar(22);
      r.speed = 22;
      r.yaw = Math.atan2(samp.tangent.x, samp.tangent.z);
      if (r.isPlayer) this.flashToast('RAIL RECOVER');
      this.fx.burst(r.position, 0x00f0ff, 8, 8);
    }
  }

  tryUseItem(racer) {
    if (!racer || !racer.item || racer.itemCooldown > 0 || racer.finished) return;
    const result = useItem(racer, this.racers, this.itemWorld, this.track, (x) => this.placeOf(x));
    if (!result) return;
    if (racer.isPlayer) this.sfx.useItem();
    for (const ev of result.events) {
      if (ev.kind === 'toast' && (ev.who === this.player?.id || racer.isPlayer)) {
        this.flashToast(ev.text);
      }
      if (ev.kind === 'lash') {
        const from = this.racers.find((x) => x.id === ev.from);
        const to = this.racers.find((x) => x.id === ev.to);
        if (from && to) this.fx.lashBolt(from.position, to.position, 0xffe566);
      }
      if (ev.kind === 'emp') {
        this.fx.empRing(ev.at, 0xff2bd6);
        if (racer.isPlayer) this.fx.addShake(0.3);
      }
    }
  }

  updateProgress() {
    for (const r of this.racers) {
      if (r.finished) {
        r.progress = 1e9 - r.finishTime;
      } else {
        // Monotonic cumulative arc-length (projectRacer already computed it and
        // handled the lap wrap), so ranking never jumps a full lap at the last
        // checkpoint / start line. Also drops the redundant per-frame project().
        r.progress = r.trackS;
      }
    }
  }

  placeOf(racer) {
    const rank = this.ranking();
    return rank.findIndex((x) => x.id === racer.id) + 1;
  }

  ranking() {
    return [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
  }

  syncMesh(r) {
    r.mesh.position.copy(r.position);
    r.mesh.rotation.order = 'YXZ';
    r.mesh.rotation.y = r.yaw;
    r.mesh.rotation.z = r.roll;
    r.mesh.rotation.x = r.airborne ? -0.12 : r.drifting ? -0.06 : 0;
  }

  updateCamera(dt) {
    const p = this.player;
    if (!p) return;
    this.forwardFromYaw(p);
    const distMul = this.settings?.cameraDist ?? 1;
    const behind = p.forward.clone().multiplyScalar((-12 - Math.min(4, p.speed * 0.05)) * distMul);
    behind.y = 4.5 + Math.min(1.5, p.speed * 0.02) + p.hopY * 0.35;
    this.camPos.copy(p.position).add(behind);
    this.camera.position.lerp(this.camPos, 1 - Math.exp(-7 * dt));
    const look = p.position.clone().addScaledVector(p.forward, 14);
    look.y += 1.2;
    this.camera.lookAt(look);
    const baseFov = this.settings?.fov ?? 68;
    const fovT =
      p.overclockTimer > 0 || ((this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && p.turbine > 2)
        ? baseFov + 10
        : baseFov;
    this.camera.fov = lerp(this.camera.fov, fovT, 1 - Math.exp(-5 * dt));
    this.camera.updateProjectionMatrix();
    this.fx.applyCameraShake(this.camera);
  }

  flashToast(text) {
    if (!this.els.toast) return;
    this.els.toast.textContent = text;
    this.els.toast.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.els.toast.classList.remove('show'), 1100);
  }

  updateHud() {
    const p = this.player;
    if (!p) return;
    const rank = this.ranking();
    const place = rank.findIndex((r) => r.id === p.id) + 1;
    // Gate DOM writes on change — rebuilding innerHTML every frame thrashes
    // layout/reflow and desyncs from rAF (a real cause of visible frame skipping).
    const hc = (this._hudCache ||= {});
    const posHtml = `${ordinal(place)}<span class="unit">/ ${this.racers.length}</span>`;
    if (this.els.pos && hc.pos !== posHtml) { this.els.pos.innerHTML = posHtml; hc.pos = posHtml; }
    const lapHtml = `${Math.min(p.lap, LAPS)}<span class="unit">/ ${LAPS}</span>`;
    if (this.els.lap && hc.lap !== lapHtml) { this.els.lap.innerHTML = lapHtml; hc.lap = lapHtml; }
    const speedHtml = `${Math.round(p.speed * 4.2)}<span class="unit">km/h</span>`;
    if (this.els.speed && hc.speed !== speedHtml) { this.els.speed.innerHTML = speedHtml; hc.speed = speedHtml; }
    if (this.els.time) this.els.time.textContent = formatTime(this.raceTime);
    if (this.els.turbine) this.els.turbine.style.width = `${p.turbine}%`;
    if (this.els.turbineN) this.els.turbineN.textContent = String(Math.round(p.turbine));

    const idef = p.item ? ITEMS[p.item] : null;
    if (this.els.item) {
      this.els.item.textContent = idef ? idef.icon : '·';
      this.els.item.style.color = idef ? idef.color : '#668';
      this.els.item.classList.toggle('has-item', !!idef);
    }
    if (this.els.itemName) this.els.itemName.textContent = idef ? idef.name : 'NO GADGET';
    // Static Veil active → light the item panel so the shield is visible on the HUD
    if (!this._itemPanelEl) this._itemPanelEl = document.getElementById('item-panel');
    if (this._itemPanelEl) this._itemPanelEl.classList.toggle('has-veil', !!p.veil);

    if (this.els.leaders) {
      const leadersHtml = rank
        .map((r, i) => {
          const me = r.id === p.id ? ' me' : '';
          const tag = r.finished ? ' ✓' : r.item ? ' ◈' : '';
          return `<div class="${me}"><span class="pos">${i + 1}</span>${r.callsign}${tag}</div>`;
        })
        .join('');
      if (hc.leaders !== leadersHtml) { this.els.leaders.innerHTML = leadersHtml; hc.leaders = leadersHtml; }
    }
    this.mode?.hudExtra?.(this);
  }

  drawMinimap() {
    if (!this.minimapCtx || !this.track) return;
    const ctx = this.minimapCtx;
    const w = this.els.minimap.width;
    const h = this.els.minimap.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(4,2,12,0.78)';
    ctx.fillRect(0, 0, w, h);
    const samp = this.track.samples;
    // Track bounds are static — compute once per track/canvas size, not every frame.
    let mb = this._miniBounds;
    if (!mb || mb.track !== this.track || mb.w !== w || mb.h !== h) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const s of samp) {
        minX = Math.min(minX, s.pos.x);
        maxX = Math.max(maxX, s.pos.x);
        minZ = Math.min(minZ, s.pos.z);
        maxZ = Math.max(maxZ, s.pos.z);
      }
      const pad = 12;
      const sx = (w - pad * 2) / (maxX - minX + 1e-6);
      const sz = (h - pad * 2) / (maxZ - minZ + 1e-6);
      const sc = Math.min(sx, sz);
      mb = this._miniBounds = { track: this.track, w, h, minX, minZ, pad, sc };
    }
    const map = (x, z) => ({
      x: mb.pad + (x - mb.minX) * mb.sc,
      y: mb.pad + (z - mb.minZ) * mb.sc,
    });
    ctx.strokeStyle = 'rgba(0,240,255,0.7)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= samp.length; i++) {
      const s = samp[i % samp.length];
      const p = map(s.pos.x, s.pos.z);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    for (const padObj of this.track.itemPads) {
      if (!padObj.alive) continue;
      const p = map(padObj.pos.x, padObj.pos.z);
      ctx.fillStyle = 'rgba(170,102,255,0.85)';
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    for (const r of this.racers) {
      const p = map(r.position.x, r.position.z);
      ctx.fillStyle = r.isPlayer ? '#00f0ff' : '#ff2bd6';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r.isPlayer ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  endRace() {
    if (this.phase === 'finished') return; // fire once, the moment the player finishes
    this.phase = 'finished';
    this.sfx.finish();
    this.refreshResults();
    this.els.results?.classList.remove('hidden');
  }

  /** Live results — refreshed each frame while the field finishes; DNF once over. */
  refreshResults() {
    if (this.mode?.results) { this.mode.results(this); return; } // TIME TRIAL owns its results panel
    const rank = this.ranking();
    const place = rank.findIndex((r) => r.id === this.player.id) + 1;
    const titles = ['GRID CROWN — 1st', 'SILVER RAIL — 2nd', 'BRONZE SPARK — 3rd'];
    if (this.els.resultsTitle) this.els.resultsTitle.textContent = titles[place - 1] || `FINISH · ${ordinal(place)}`;
    if (!this.els.resultsStats) return;
    this.els.resultsStats.innerHTML = rank
      .map((r, i) => {
        let t;
        if (r.finished) t = formatTime(r.finishTime);
        else if (r.id === this.player.id) t = formatTime(this.player.finishTime);
        else t = this._raceOver ? 'DNF' : 'racing…';
        return `<div>${i + 1}. ${r.callsign} — ${t} · ${r.vehicle.name}</div>`;
      })
      .join('');
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
