// DYEFIELD — the running game: fixed 60 Hz sim + interpolated rendering (CONTRACT §2, §5.1).
//
//   * frame(now): accumulate real time, run at most MAX_STEPS_PER_FRAME ticks, drop the rest of the
//     debt, render interpolated between the last two ticks (alpha = acc / TICK).
//   * pause gates simStep() itself (doctrine §5): a paused game cannot advance no matter who calls
//     it, and the accumulator is discarded so resume never fast-forwards the paused time.
//   * window.__PAUSE__ = { pause, resume, toggle } (doctrine §6). ESC pauses; losing pointer lock
//     pauses; RESUME re-captures the mouse.
//   * the view reads the sim, never writes gameplay: paint flows sim → Painter → (dirty rows) →
//     PaintTexture.upload → GPU, and Painter.onFlip → MinimapRaster.apply → HUD canvas.
//   * adaptive render resolution: every frame interval is fed to the renderer rig's governor while
//     in play (view/renderer.ts); entering play (re)starts its 2 s no-scaling grace. Settings hook:
//     settings.quality 'auto' | 'high' | 'low' → setQuality() (no UI this phase; ?quality= sets it).

import * as THREE from 'three';
import { TICK, MAX_STEPS_PER_FRAME, MOVE } from './core/config.ts';
import { emptyIntent, type PlayerIntent } from './core/types.ts';
import type { MapDef } from './core/data.ts';
import type { MapGeometry } from './core/mapgeo.ts';
import type { PaintAtlas } from './core/paint/atlas.ts';
import type { Painter } from './core/paint/painter.ts';
import type { MinimapRaster } from './core/paint/minimap.ts';
import type { PhysicsWorld } from './core/physics.ts';
import { angleDelta, type Player } from './core/player.ts';
import type { RendererRig, RenderQuality } from './view/renderer.ts';
import type { FollowCamera } from './view/camera.ts';
import type { SkyRig } from './view/sky.ts';
import type { WaterRig } from './view/water.ts';
import type { PaintTexture, } from './view/paintlayer.ts';
import type { DyeUniforms } from './view/surfaces.ts';
import type { MapView } from './view/mapview.ts';
import type { HeroView } from './view/heroview.ts';
import type { Hud, HudDebug } from './ui/hud.ts';
import type { BootUI } from './ui/boot.ts';
import type { Input } from './input.ts';

export type Phase = 'boot' | 'loading' | 'ready' | 'play' | 'paused' | 'error';

/** App-wide status that exists before the Game does (the test surface reads it from boot on). */
export interface AppStatus {
  phase: Phase;
  mapId: string;
  dev: boolean;
  error?: string;
  version: string;
  game: Game | null;
  /** how play was entered: 'pointerlock' (real click) | 'dev-start' (__DF__.start, no lock) */
  startedBy: 'pointerlock' | 'dev-start' | null;
  lockErrors: number;
  lockSuccesses: number;
}

export interface GameParts {
  app: AppStatus;
  def: MapDef;
  canvas: HTMLCanvasElement;
  rig: RendererRig;
  scene: THREE.Scene;
  cam: FollowCamera;
  sky: SkyRig;
  water: WaterRig;
  map: MapView;
  geo: MapGeometry;
  atlas: PaintAtlas;
  painter: Painter;
  minimap: MinimapRaster;
  paint: PaintTexture;
  dye: DyeUniforms;
  physics: PhysicsWorld;
  player: Player;
  hero: HeroView;
  hud: Hud;
  boot: BootUI;
  input: Input;
}

/** player-facing settings (hooks only this phase — no settings UI yet) */
export interface GameSettings {
  quality: RenderQuality;
}

export class Game {
  readonly p: GameParts;
  readonly settings: GameSettings;
  tick = 0;
  fps = 0;
  frames = 0;
  private acc = 0;
  private last = -1;
  private fpsClock = 0;
  private fpsFrames = 0;
  private time = 0;
  private raf = 0;
  private readonly intent: PlayerIntent = emptyIntent();
  private readonly focus = new THREE.Vector3();
  private readonly feet = { x: 0, y: 0, z: 0 };
  private lastYaw = 0;
  private yawRate = 0;
  private visY = NaN;
  private stepping = false;
  /** id of the outstanding pointer-lock request (0 = none) */
  private lockReq = 0;
  private lockSeq = 0;

  constructor(parts: GameParts, settings: Partial<GameSettings> = {}) {
    this.p = parts;
    this.settings = { quality: settings.quality ?? parts.rig.adaptive().quality };
    const { input, hud, canvas } = parts;
    input.onUi((a) => {
      if (a === 'debug') hud.toggleDebug();
      else if (a === 'pause') {
        if (this.phase === 'play') this.pause('esc');
        else if (this.phase === 'paused') this.resume();
      }
    });
    hud.onResume = () => this.resume();
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (locked) {
        this.lockReq = 0;
        parts.app.lockSuccesses++;
        if (this.phase === 'ready' || this.phase === 'paused') this.enterPlay('pointerlock');
      } else if (this.phase === 'play' && parts.app.startedBy === 'pointerlock') {
        this.pause('pointer lock lost');
      }
    });
    document.addEventListener('pointerlockerror', () => this.lockFailed(this.lockReq, 'pointerlockerror'));
    (window as unknown as { __PAUSE__: unknown }).__PAUSE__ = {
      pause: () => this.pause('api'),
      resume: () => this.resume(),
      toggle: () => (this.phase === 'paused' ? this.resume() : this.pause('api')),
    };
    this.lastYaw = parts.player.yaw;
  }

  get phase(): Phase { return this.p.app.phase; }
  private set phase(v: Phase) { this.p.app.phase = v; }

  /** start the render loop (the scene renders behind the CLICK TO PLAY card) */
  run(): void {
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      try {
        this.frame(now);
      } catch (e) {
        cancelAnimationFrame(this.raf);
        this.fail(e);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  fail(e: unknown): void {
    const msg = e instanceof Error ? (e.stack || e.message) : String(e);
    this.p.app.phase = 'error';
    this.p.app.error = msg;
    this.p.input.live = false;
    this.p.hud.show(false);
    this.p.boot.error('The match stopped', msg);
    console.error('[dyefield] frame error:', e);
  }

  /** CLICK TO PLAY: ask for pointer lock; play begins on pointerlockchange. */
  requestPlay(): void {
    if (this.phase !== 'ready' && this.phase !== 'paused') return;
    const c = this.p.canvas;
    if (document.pointerLockElement === c) { this.enterPlay('pointerlock'); return; }
    const id = ++this.lockSeq;
    this.lockReq = id;
    try {
      const r = c.requestPointerLock({ unadjustedMovement: false } as PointerLockOptions) as unknown;
      if (r && typeof (r as Promise<void>).then === 'function') {
        (r as Promise<void>).then(() => undefined, (err: unknown) => this.lockFailed(id, err instanceof Error ? err.message : String(err)));
      }
    } catch (err) {
      this.lockFailed(id, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * One refused request counts once (Chrome reports the same refusal twice: the promise rejects AND
   * a pointerlockerror fires). Doctrine §6: 2+ refusals with zero successful locks ever → tell the
   * player ("MOUSE CAPTURE BLOCKED"), while a click on that card still retries.
   */
  private lockFailed(id: number, why: string): void {
    if (id === 0 || id !== this.lockReq) return;
    this.lockReq = 0;
    const app = this.p.app;
    app.lockErrors++;
    console.warn(`[dyefield] pointer lock refused (${app.lockErrors}): ${why}`);
    if (app.lockErrors >= 2 && app.lockSuccesses === 0 && (this.phase === 'ready' || this.phase === 'paused')) {
      this.p.boot.showBlocked(() => this.requestPlay());
      this.p.hud.setPaused(false);
    } else if (this.phase === 'paused') {
      this.p.hud.setPaused(true, 'Click RESUME again to capture the mouse.');
    }
  }

  /** Settings hook: render quality 'auto' (adaptive resolution) · 'high' (DPR cap) · 'low' (floor). */
  setQuality(q: RenderQuality): void {
    this.settings.quality = q;
    this.p.rig.setQuality(q);
    if (this.phase === 'play') this.p.rig.graceFor(2);
  }

  /** dev-only (__DF__.start): enter play without pointer lock */
  devStart(): void {
    if (this.phase === 'ready' || this.phase === 'paused') this.enterPlay('dev-start');
  }

  private enterPlay(by: 'pointerlock' | 'dev-start'): void {
    this.p.app.startedBy = by;
    this.acc = 0;
    this.last = -1;
    this.p.input.releaseAll();
    this.p.input.live = true;
    this.phase = 'play';
    this.p.rig.graceFor(2);                       // never rescale in the first 2 s of play
    this.p.boot.hide();
    this.p.hud.setPaused(false);
    this.p.hud.show(true);
    this.p.canvas.focus({ preventScroll: true });
  }

  pause(reason = 'api'): void {
    if (this.phase !== 'play') return;
    this.phase = 'paused';
    this.acc = 0;
    this.p.input.live = false;
    this.p.input.releaseAll();
    this.p.hud.setPaused(true, reason === 'pointer lock lost' ? 'Mouse released.' : '');
    // phase is already 'paused', so the pointerlockchange this causes is a no-op
    if (document.pointerLockElement === this.p.canvas) document.exitPointerLock();
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    if (this.p.app.startedBy === 'pointerlock') this.requestPlay();
    else this.enterPlay('dev-start');
  }

  /** One fixed sim tick — gated: nothing advances unless the game is in play. */
  simStep(): boolean {
    if (this.phase !== 'play' || this.stepping) return false;
    this.stepping = true;
    try {
      const { input, cam, player, painter } = this.p;
      input.intent(cam.yaw, cam.pitch, this.intent);
      player.step(TICK, this.intent, painter);
      this.tick++;
    } finally {
      this.stepping = false;
    }
    return true;
  }

  frame(now: number): void {
    const p = this.p;
    const rawMs = this.last < 0 ? 0 : now - this.last;
    let dt = this.last < 0 ? 1 / 60 : rawMs / 1000;
    this.last = now;
    p.rig.frameTime(rawMs, this.phase === 'play');
    if (!(dt >= 0)) dt = 0;
    dt = Math.min(dt, 0.25);
    this.frames++;
    this.fpsFrames++;
    this.fpsClock += dt;
    if (this.fpsClock >= 0.5) { this.fps = this.fpsFrames / this.fpsClock; this.fpsFrames = 0; this.fpsClock = 0; }

    const playing = this.phase === 'play';
    if (playing) {
      const m = p.input.takeMouse();
      p.cam.addMouse(m.dx, m.dy);
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK && steps < MAX_STEPS_PER_FRAME) {
        this.simStep();
        this.acc -= TICK;
        steps++;
      }
      if (this.acc >= TICK) this.acc %= TICK;      // drop the excess debt
    } else {
      this.acc = 0;
      p.input.takeMouse();
    }
    // visuals (water, dye sparkle, idle animation) stay alive behind the CLICK TO PLAY card and
    // freeze with the sim while paused
    const vdt = this.phase === 'paused' || this.phase === 'error' ? 0 : dt;
    this.time += vdt;
    const alpha = playing ? Math.min(1, this.acc / TICK) : 1;
    this.render(vdt, alpha);
  }

  /** interpolated render of the current state (also used by __DF__.shot) */
  render(dt: number, alpha = 1): void {
    const p = this.p;
    const pl = p.player;
    const x = pl.px + (pl.x - pl.px) * alpha;
    const y = pl.py + (pl.y - pl.py) * alpha;
    const z = pl.pz + (pl.z - pl.pz) * alpha;
    const yaw = pl.pyaw + angleDelta(pl.pyaw, pl.yaw) * alpha;

    // visual feet: sit on the ground under the capsule when grounded (the KCC keeps a 2 cm skin)
    let vy = y - MOVE.skin;
    if (pl.grounded) {
      const h = p.physics.raycast(x, y + 0.4, z, 0, -1, 0, 0.8);
      if (h && Math.abs(h.y - y) < 0.12) vy = h.y;
    }
    if (!Number.isFinite(this.visY) || Math.abs(vy - this.visY) > 0.5 || !pl.grounded) this.visY = vy;
    else this.visY += (vy - this.visY) * (1 - Math.exp(-30 * Math.max(dt, 1 / 120)));

    if (dt > 0) {
      const d = angleDelta(this.lastYaw, yaw);
      this.yawRate += (d / dt - this.yawRate) * (1 - Math.exp(-10 * dt));
    }
    this.lastYaw = yaw;

    p.hero.setPose(x, this.visY, z, yaw);
    p.hero.animate(dt, {
      speed: pl.speed, vy: pl.vy, grounded: pl.grounded, brushing: pl.brushing && this.phase === 'play',
      jumps: pl.jumps, landings: pl.landings, airTime: pl.airTime, yawRate: this.yawRate,
    });

    this.feet.x = x; this.feet.y = y; this.feet.z = z;
    p.cam.update(dt, this.feet, p.physics);
    this.focus.set(x, y + 0.6, z);
    p.sky.update(dt, p.cam.camera, this.focus);
    p.water.update(this.time, p.cam.camera);
    const ut = p.dye.uTime;
    if (ut) ut.value = this.time;
    p.paint.upload(p.painter);

    p.rig.resize(p.cam.camera);
    p.rig.beginFrame();
    p.rig.renderer.render(p.scene, p.cam.camera);

    p.hud.update(dt, {
      coverage: p.painter.coverage(), tank: pl.tank, x, z, yaw, brushing: pl.brushing && this.phase === 'play',
    }, () => this.debugInfo());
  }

  debugInfo(): HudDebug {
    const p = this.p;
    const pl = p.player;
    const st = p.rig.stats();
    const ad = p.rig.adaptive();
    return {
      coverage: p.painter.coverage(), tank: pl.tank, mapId: p.def.id, fps: this.fps, state: pl.state, grounded: pl.grounded,
      atlasSize: p.atlas.size, atlasCount: p.atlas.count, overlaps: p.atlas.overlaps,
      calls: st.calls, triangles: st.triangles, programs: st.programs, tick: this.tick,
      x: pl.x, y: pl.y, z: pl.z, flips: p.painter.flips, speed: pl.speed,
      anim: `${p.hero.baseRole}${p.hero.brushWeight > 0.05 ? ` + brush ${(p.hero.brushWeight * 100).toFixed(0)}%` : ''}`,
      pointerLock: document.pointerLockElement === p.canvas,
      scale: ad.scale, scaleMin: ad.min, scaleMax: ad.max, quality: ad.quality,
      buffer: [p.canvas.width, p.canvas.height], p90: ad.p90, targetMs: ad.targetMs,
    };
  }
}
