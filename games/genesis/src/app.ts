// GENESIS — the App (CONTRACT.md §3): owns the SimClient, the Renderer, the camera rig, the HUD and input, and runs
// the frame loop. The sim runs at a fixed tick rate in its worker (or the lookdev generator); this loop is variable
// rate: per animation frame it advances the interpolated render clock, updates the camera, renders, then asks the sim
// for the next snapshot (≤ 30 Hz). Errors inside a frame are counted; persistent failure raises the fatal card.

import { Vector2 } from 'three';
import type { Command, CommandResult } from './sim/types.ts';
import { SimClient } from './client/simclient.ts';
import { findPoi } from './client/poi.ts';
import { Renderer } from './render/renderer.ts';
import { CameraRig } from './render/camera/rig.ts';
import { newInput, type InputState } from './render/camera/common.ts';
import { detectQuality, isQualityName, type QualityName } from './render/quality.ts';
import { pick, rayDirection, type PickHit } from './render/picking.ts';
import { Hud } from './ui/hud.ts';

export interface AppOptions {
  scenario: string;
  seed: number;
  source: 'auto' | 'worker' | 'lookdev';
  quality: QualityName | 'auto';
  speed: number;
  dev: boolean;
  intro: boolean;
  cam: string | null;
  ui: boolean;
  hour: number | null;
  exposure: number;
}

export function parseParams(search: string): AppOptions {
  const p = new URLSearchParams(search);
  const q = p.get('quality');
  const src = p.get('source');
  const num = (k: string, d: number) => { const v = Number(p.get(k)); return p.has(k) && Number.isFinite(v) ? v : d; };
  return {
    scenario: p.get('scenario') ?? 'lookdev',
    seed: Math.floor(num('seed', 20260)),
    source: src === 'lookdev' || src === 'worker' ? src : 'auto',
    quality: isQualityName(q) ? q : 'auto',
    speed: num('speed', 1),
    dev: p.get('dev') === '1',
    intro: p.get('intro') !== '0',
    cam: p.get('cam'),
    ui: p.get('ui') !== '0',
    hour: p.has('hour') ? num('hour', 10) : null,
    exposure: num('exposure', 0),
  };
}

/** test-surface / URL camera spec (CONTRACT.md §18) */
export interface CameraSpec {
  mode?: 'orbit' | 'surface' | 'system' | 'fly' | 'follow' | 'dolly' | 'walk' | 'photo';
  planet?: number;
  lat?: number;
  lon?: number;
  alt?: number;
  yaw?: number;
  pitch?: number;
  dist?: number;
  tilt?: number;
  target?: unknown;
  /** named place found from the fields: coast, valley, peak, town, forest, desert */
  poi?: string;
  /** local solar hour at the camera position */
  hour?: number;
  /** extra heading relative to the POI's look direction (deg) */
  turn?: number;
  /** after setting the hour, turn to face the sun's azimuth (+ turn) */
  faceSun?: boolean;
  /** instead of an hour: put the (evening) sun at this elevation (deg) above the camera's astronomical horizon */
  sunElevation?: number;
  fov?: number;
  /** blend seconds (0 = cut) */
  blend?: number;
}

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly opts: AppOptions;
  readonly sim = new SimClient();
  renderer!: Renderer;
  readonly rig = new CameraRig();
  hud!: Hud;
  readonly input: InputState = newInput();
  onFatal: ((title: string, err: unknown) => void) | null = null;
  quality: QualityName = 'high';
  fps = 60;
  frames = 0;
  private last = 0;
  private startAt = 0;
  private raf = 0;
  private running = false;
  private frameErrors = 0;
  private captureWaiters: ((url: string) => void)[] = [];
  private frameWaiters: { n: number; ok: () => void }[] = [];
  private hover: PickHit | null = null;
  private pointer = new Vector2(-1, -1);
  private pointerDirty = false;
  brushRadius = 60;
  private uiVisible = true;
  private v2 = new Vector2();

  constructor(canvas: HTMLCanvasElement, opts: AppOptions) {
    this.canvas = canvas;
    this.opts = opts;
  }

  async start(progress: (msg: string, frac: number) => void): Promise<void> {
    progress('Lighting the star…', 0.08);
    this.renderer = new Renderer(this.canvas);
    const gl = this.renderer.three.getContext() as WebGL2RenderingContext;
    this.quality = this.opts.quality === 'auto' ? detectQuality(gl) : this.opts.quality;
    this.renderer.setQuality(this.quality);
    this.renderer.settings.exposureBias = this.opts.exposure;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    progress('Forming the worlds…', 0.22);
    this.sim.onFatal = (msg) => this.onFatal?.('the simulation stopped', msg);
    await this.sim.start({ source: this.opts.source, scenario: this.opts.scenario, seed: this.opts.seed });
    progress('Gathering the air…', 0.62);
    this.sim.setSpeed(this.opts.speed);
    this.hud = new Hud(document.getElementById('ui') ?? document.body, {
      setSpeed: (x) => this.setSpeed(x),
      step: (t) => { void this.step(t); },
      flyTo: (id) => this.flyTo(id),
    }, this.opts.dev);
    this.hud.setVisible(this.opts.ui);
    this.uiVisible = this.opts.ui;
    this.installInput();
    // initial camera: the home world from orbit, or a URL preset
    const view = this.sim.view;
    view.update(performance.now());
    const home = view.planets[0];
    if (home) {
      this.rig.orbit.setFromLatLon(home.id, 18, -35, home.params.radius * 2.6);
      this.rig.use(this.rig.orbit, 0);
    }
    if (this.opts.cam) await this.applyCameraPreset(this.opts.cam);
    if (this.opts.hour != null) await this.setLocalHour(this.opts.hour);
    progress('The first light…', 0.86);
    // warm-up frames: build the near terrain, the LUTs and the cloud noise before the boot card fades
    for (let i = 0; i < 3; i++) this.frame(performance.now());
    this.startAt = performance.now();
    progress('', 1);
    this.running = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      // a hidden tab renders nothing (the sim keeps its own pace in the worker)
      if (document.hidden && !this.frameWaiters.length && !this.captureWaiters.length) { this.last = t; return; }
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
    if (this.sim.source === 'lookdev') this.hud.toast('Lookdev world: the simulation is not running here — light, sky and land only.', 6000);
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.resize(w, h, window.devicePixelRatio || 1);
    this.input.viewH = h;
  }

  /** one frame: clock → camera → render → snapshot request → HUD */
  frame(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    try {
      const view = this.sim.view;
      view.update(now);
      const pose = this.rig.update(dt, view, this.input);
      if (this.rig.cut) { this.renderer.cut(); this.rig.cut = false; }
      if (this.pointerDirty && this.frames % 2 === 0) this.updateHover();
      this.renderer.setBrush(this.hover ? { planet: this.hover.planet, dir: this.hover.dir, radius: this.brushRadius } : null);
      this.renderer.render(view, pose, dt, (now - this.startAt) / 1000);
      if (this.captureWaiters.length) {
        const url = this.renderer.snapshotDataURL();
        for (const w of this.captureWaiters.splice(0)) w(url);
      }
      this.sim.pump(now);
      this.fps = this.fps * 0.92 + (dt > 0 ? 1 / dt : 60) * 0.08;
      this.hud.update({
        view, pose, stats: this.renderer.stats, fps: this.fps, primary: this.renderer.primaryId,
        systemView: this.rig.mode === 'system' || this.renderer.stats.altitude > 3e5,
        project: (s, out) => this.renderer.projectToScreen(s, pose, out), source: this.sim.source, snapshotHz: this.sim.snapshotHz,
      });
      this.frameErrors = 0;
    } catch (e) {
      this.frameErrors++;
      console.error('[genesis] frame failed', e);
      if (this.frameErrors > 8) { this.running = false; this.onFatal?.('the renderer stopped', e); }
    }
    // consume per-frame input
    this.input.dragL[0] = this.input.dragL[1] = 0;
    this.input.dragR[0] = this.input.dragR[1] = 0;
    this.input.dragM[0] = this.input.dragM[1] = 0;
    this.input.wheel = 0;
    this.frames++;
    for (let i = this.frameWaiters.length - 1; i >= 0; i--) {
      if (--this.frameWaiters[i].n <= 0) { this.frameWaiters[i].ok(); this.frameWaiters.splice(i, 1); }
    }
  }

  // ── input ──

  private installInput(): void {
    const c = this.canvas;
    let buttons = 0;
    let downX = 0, downY = 0, lastX = 0, lastY = 0;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      buttons = e.buttons;
      downX = lastX = e.clientX; downY = lastY = e.clientY;
      c.focus();
    });
    c.addEventListener('pointermove', (e) => {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      this.pointer.set(e.clientX, e.clientY);
      this.pointerDirty = true;
      if (!e.buttons) return;
      if (e.buttons & 1) { this.input.dragL[0] += dx; this.input.dragL[1] += dy; }
      if (e.buttons & 2) { this.input.dragR[0] += dx; this.input.dragR[1] += dy; }
      if (e.buttons & 4) { this.input.dragM[0] += dx; this.input.dragM[1] += dy; }
    });
    c.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) < 4 && (buttons & 1)) this.onClick(e.clientX, e.clientY);
      buttons = 0;
    });
    c.addEventListener('pointerleave', () => { this.hover = null; this.pointerDirty = false; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      this.input.wheel += e.deltaY * scale;
    }, { passive: false });
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      this.input.keys.add(e.code);
      this.input.shift = e.shiftKey;
      this.onKey(e);
    });
    window.addEventListener('keyup', (e) => { this.input.keys.delete(e.code); this.input.shift = e.shiftKey; });
    window.addEventListener('blur', () => this.input.keys.clear());
  }

  private onKey(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyP': this.setSpeed(this.sim.view.speed === 0 ? 1 : 0); break;
      case 'KeyG': if (this.rig.mode === 'system') this.flyTo(this.renderer.primaryId); else this.systemView(); break;
      case 'KeyV': this.toggleFly(); break;
      case 'Escape': if (this.rig.mode !== 'orbit') this.flyTo(this.renderer.primaryId >= 0 ? this.renderer.primaryId : 0); break;
      case 'BracketLeft': this.brushRadius = Math.max(5, this.brushRadius / 1.25); break;
      case 'BracketRight': this.brushRadius = Math.min(2000, this.brushRadius * 1.25); break;
      case 'Comma': this.stepSpeed(-1); break;
      case 'Period': this.stepSpeed(1); break;
      case 'KeyH': this.setUi(!this.uiVisible); break;
      default: return;
    }
  }

  private updateHover(): void {
    this.pointerDirty = false;
    if (this.pointer.x < 0) { this.hover = null; return; }
    const ndcX = (this.pointer.x / window.innerWidth) * 2 - 1;
    const ndcY = 1 - (this.pointer.y / window.innerHeight) * 2;
    const dir = rayDirection(this.renderer.camera, ndcX, ndcY, [0, 0, 0]);
    this.hover = pick(this.sim.view, this.rig.pose, dir);
  }

  private onClick(x: number, y: number): void {
    const ndcX = (x / window.innerWidth) * 2 - 1;
    const ndcY = 1 - (y / window.innerHeight) * 2;
    const dir = rayDirection(this.renderer.camera, ndcX, ndcY, [0, 0, 0]);
    const hit = pick(this.sim.view, this.rig.pose, dir);
    if (!hit) {
      // far away a world is a few pixels: take the nearest projected planet within 28 px
      let best = -1, bestD = 28;
      for (const pv of this.sim.view.planets) {
        const p = this.renderer.projectToScreen(pv.center, this.rig.pose, this.v2);
        if (!p) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) { bestD = d; best = pv.id; }
      }
      if (best >= 0 && (this.rig.mode === 'system' || best !== this.renderer.primaryId)) this.flyTo(best);
      return;
    }
    if (this.rig.mode === 'system' || hit.planet !== this.renderer.primaryId) { this.flyTo(hit.planet); return; }
    // phase 1: clicking the ground recentres the orbit on it (powers arrive with the god layer)
    if (this.rig.mode === 'orbit') {
      const o = this.rig.orbit;
      o.focus = [hit.dir[0], hit.dir[1], hit.dir[2]];
    }
  }

  // ── actions (HUD, keys, test surface) ──

  setSpeed(x: number): void { this.sim.setSpeed(Math.max(0, x)); }
  private stepSpeed(d: number): void {
    const presets = [0, 1, 10, 100, 1000];
    const i = presets.indexOf(this.sim.view.speed);
    this.setSpeed(presets[Math.max(0, Math.min(presets.length - 1, (i < 0 ? 1 : i) + d))]);
  }
  async step(ticks: number): Promise<number> { return this.sim.step(ticks); }
  cmd(c: Command): Promise<CommandResult> { return this.sim.cmd(c); }

  flyTo(planet: number): void {
    if (planet < 0) return;
    this.rig.flyToPlanet(this.sim.view, planet);
  }
  systemView(): void {
    this.rig.system.frame(this.sim.view);
    this.rig.use(this.rig.system, 2.6);
  }
  private toggleFly(): void {
    if (this.rig.mode === 'fly' || this.rig.mode === 'surface') { this.rig.use(this.rig.orbit, 1.2); return; }
    const pv = this.sim.view.planet(this.renderer.primaryId) ?? this.sim.view.planets[0];
    if (!pv) return;
    // start flying from the current pose: position + level orientation looking where the camera looks
    const f = this.rig.fly;
    const p = this.rig.pose.pos;
    const rel: [number, number, number] = [p[0] - pv.center[0], p[1] - pv.center[1], p[2] - pv.center[2]];
    const q = pv.quat;
    const qi: [number, number, number, number] = [-q[0], -q[1], -q[2], q[3]];
    f.planet = pv.id;
    f.pos = rotate(qi, rel);
    const fwdSys = rotate(this.rig.pose.quat, [0, 0, -1]);
    const fwd = rotate(qi, fwdSys);
    const r = Math.hypot(...f.pos);
    const up = [f.pos[0] / r, f.pos[1] / r, f.pos[2] / r];
    const e = [up[2], 0, -up[0]];
    const el = Math.hypot(e[0], e[2]) || 1; e[0] /= el; e[2] /= el;
    const n = [up[1] * e[2] - up[2] * e[1], up[2] * e[0] - up[0] * e[2], up[0] * e[1] - up[1] * e[0]];
    const fu = fwd[0] * up[0] + fwd[1] * up[1] + fwd[2] * up[2];
    f.pitch = Math.asin(Math.max(-1, Math.min(1, fu)));
    f.yaw = Math.atan2(fwd[0] * e[0] + fwd[1] * e[1] + fwd[2] * e[2], fwd[0] * n[0] + fwd[1] * n[1] + fwd[2] * n[2]);
    f.roll = 0;
    f.mode = 'fly';
    f.holdAltitude = null;
    this.rig.use(f, 0.4);
  }

  setUi(v: boolean): void {
    this.uiVisible = v;
    this.hud.setVisible(v);
  }

  setQuality(name: QualityName): void {
    this.quality = name;
    this.renderer.setQuality(name);
  }

  /** resolve when `n` more frames have been rendered */
  waitFrames(n: number): Promise<void> {
    return new Promise((ok) => this.frameWaiters.push({ n: Math.max(1, n), ok }));
  }

  /** PNG data URL of the next rendered frame */
  capture(): Promise<string> {
    return new Promise((ok) => this.captureWaiters.push(ok));
  }

  /** set the planet's clock so the local solar hour at the camera (or a longitude) is `hour` */
  async setLocalHour(hour: number, lonDeg?: number): Promise<void> {
    const pv = this.sim.view.planet(this.renderer?.primaryId ?? 0) ?? this.sim.view.planets[0];
    if (!pv) return;
    let lon = lonDeg;
    if (lon == null) {
      const p = this.rig.pose.pos;
      const rel: [number, number, number] = [p[0] - pv.center[0], p[1] - pv.center[1], p[2] - pv.center[2]];
      const b = rotate([-pv.quat[0], -pv.quat[1], -pv.quat[2], pv.quat[3]], rel);
      lon = (Math.atan2(b[0], b[2]) * 180) / Math.PI;
    }
    const h0 = (((hour - (lon / 360) * pv.params.dayHours) % pv.params.dayHours) + pv.params.dayHours) % pv.params.dayHours;
    await this.sim.cmd({ k: 'time.set-hour', planet: pv.id, hour: h0 });
    this.sim.requestFull();
  }

  async camera(spec: CameraSpec): Promise<void> {
    const view = this.sim.view;
    view.update(performance.now());
    const mode = spec.mode ?? 'orbit';
    const planet = spec.planet ?? (this.renderer.primaryId >= 0 ? this.renderer.primaryId : view.planets[0]?.id ?? 0);
    const pv = view.planet(planet);
    let lat = spec.lat ?? 20, lon = spec.lon ?? 0, heading = spec.yaw ?? 0;
    if (spec.poi && pv) {
      const poi = findPoi(pv, spec.poi);
      if (poi) { lat = poi.lat; lon = poi.lon; heading = poi.heading + (spec.turn ?? 0) + (spec.yaw ?? 0); }
    }
    const blend = spec.blend ?? 0;
    if (mode === 'system') {
      this.rig.system.frame(view);
      if (spec.dist) this.rig.system.dist = spec.dist;
      if (spec.yaw != null) this.rig.system.yaw = (spec.yaw * Math.PI) / 180;
      if (spec.pitch != null) this.rig.system.pitch = (spec.pitch * Math.PI) / 180;
      if (spec.fov) this.rig.system.fov = spec.fov;
      this.rig.use(this.rig.system, blend);
    } else if (mode === 'surface' || mode === 'fly' || mode === 'walk' || mode === 'photo') {
      this.rig.fly.setSurface(planet, view, lat, lon, spec.alt ?? 30, heading, spec.pitch ?? -4);
      if (spec.fov) this.rig.fly.fov = spec.fov;
      this.rig.use(this.rig.fly, blend);
    } else {
      const R = pv?.params.radius ?? 3000;
      const dist = spec.dist ?? (spec.alt != null ? spec.alt : R * 2.6);
      this.rig.orbit.setFromLatLon(planet, lat, lon, dist, heading, spec.tilt ?? (spec.pitch != null ? 90 + spec.pitch : null));
      if (spec.fov) this.rig.orbit.fov = spec.fov;
      this.rig.use(this.rig.orbit, blend);
    }
    if (blend === 0) this.renderer?.cut();
    let hour = spec.hour;
    if (spec.sunElevation != null && pv) {
      // solve the hour angle for the wanted elevation with the sun's current declination (evening branch)
      const d = Math.hypot(pv.center[0], pv.center[1], pv.center[2]) || 1;
      const sunB = rotate([-pv.quat[0], -pv.quat[1], -pv.quat[2], pv.quat[3]], [-pv.center[0] / d, -pv.center[1] / d, -pv.center[2] / d]);
      const dec = Math.asin(Math.max(-1, Math.min(1, sunB[1])));
      const phi = (lat * Math.PI) / 180, el = (spec.sunElevation * Math.PI) / 180;
      const cosH = (Math.sin(el) - Math.sin(phi) * Math.sin(dec)) / Math.max(1e-6, Math.cos(phi) * Math.cos(dec));
      const H = Math.acos(Math.max(-1, Math.min(1, cosH)));
      hour = 12 + (H / Math.PI) * 12 * (pv.params.dayHours / 24);
    }
    if (hour != null) {
      // compute the pose once so "local" means the new camera position
      this.rig.update(0, view, newInput());
      await this.setLocalHour(hour, lon);
    }
    if (spec.faceSun) {
      // wait for the new clock to arrive, then turn toward the sun's azimuth at the camera's position
      await this.waitFrames(3);
      const pvs = this.sim.view.planet(planet);
      if (pvs) {
        const d = Math.hypot(pvs.center[0], pvs.center[1], pvs.center[2]) || 1;
        const sun = rotate([-pvs.quat[0], -pvs.quat[1], -pvs.quat[2], pvs.quat[3]], [-pvs.center[0] / d, -pvs.center[1] / d, -pvs.center[2] / d]);
        const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
        const up = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
        const e = [up[2], 0, -up[0]];
        const el = Math.hypot(e[0], e[2]) || 1; e[0] /= el; e[2] /= el;
        const n = [up[1] * e[2] - up[2] * e[1], up[2] * e[0] - up[0] * e[2], up[0] * e[1] - up[1] * e[0]];
        const az = Math.atan2(sun[0] * e[0] + sun[1] * e[1] + sun[2] * e[2], sun[0] * n[0] + sun[1] * n[1] + sun[2] * n[2]);
        const yaw = az + ((spec.turn ?? 0) * Math.PI) / 180;
        if (this.rig.active === this.rig.fly) this.rig.fly.yaw = yaw;
        else if (this.rig.active === this.rig.orbit) this.rig.orbit.heading = yaw;
        this.renderer.cut();
      }
    }
  }

  /** URL ?cam= presets */
  async applyCameraPreset(name: string): Promise<void> {
    const presets: Record<string, CameraSpec> = {
      orbit: { mode: 'orbit', lat: 18, lon: -35, dist: 7800 },
      system: { mode: 'system' },
      coast: { mode: 'orbit', poi: 'coast', dist: 520, tilt: 62 },
      valley: { mode: 'surface', poi: 'valley', alt: 30, pitch: -2 },
      peak: { mode: 'orbit', poi: 'peak', dist: 900, tilt: 58 },
      town: { mode: 'orbit', poi: 'town', dist: 650, tilt: 55 },
      forest: { mode: 'surface', poi: 'forest', alt: 60, pitch: -6 },
    };
    const spec = presets[name];
    if (spec) await this.camera(spec);
  }

  state(): Record<string, unknown> {
    const v = this.sim.view;
    const pose = this.rig.pose;
    return {
      tick: v.renderTick, snapTick: v.snapTick, speed: v.speed, achievedSpeed: v.achievedSpeed, fps: this.fps,
      scenario: this.opts.scenario, seed: this.opts.seed, source: this.sim.source, quality: this.quality, frames: this.frames,
      camera: { mode: this.rig.mode, planet: pose.planet, pos: [...pose.pos], quat: [...pose.quat], fov: pose.fov, altitude: this.renderer.stats.altitude },
      render: { ...this.renderer.stats },
      planets: v.planets.map((p) => ({
        id: p.id, name: p.name, kind: p.params.kind, radius: p.params.radius,
        pop: p.population.reduce((a, b) => a + b, 0), settlements: p.settlements.length,
        agents: p.agents?.count ?? 0, buildings: p.buildings?.count ?? 0,
        era: p.settlements[0]?.era ?? null, calendar: v.calendar(p),
      })),
      hover: this.hover,
    };
  }

  /** screen position (CSS px) of a system-frame point, for tests */
  project(sys: [number, number, number]): [number, number] | null {
    const p = this.renderer.projectToScreen(sys, this.rig.pose, this.v2);
    return p ? [p.x, p.y] : null;
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}

function rotate(q: ArrayLike<number>, v: ArrayLike<number>): [number, number, number] {
  const x = v[0], y = v[1], z = v[2];
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}
