// GENESIS — the App (CONTRACT.md §3): owns the SimClient, the Renderer, the camera rig, the HUD and input, and runs
// the frame loop. The sim runs at a fixed tick rate in its worker (or the lookdev generator); this loop is variable
// rate: per animation frame it advances the interpolated render clock, updates the camera, renders, then asks the sim
// for the next snapshot (≤ 30 Hz). Errors inside a frame are counted; persistent failure raises the fatal card.
// Clicking the world picks what is drawn there (a person, a herd, a building — the life layer's own geometry), selects
// it and opens the inspector (src/ui/inspector.ts); a marker floats over the selection, and the camera can follow it.
// The sim's events and chronicle become toasts (src/ui/toasts.ts).

import { Vector2 } from 'three';
import type { Command, CommandResult, EntityRef, UnitVec } from './sim/types.ts';
import { AgentFlag } from './sim/types.ts';
import { SimClient } from './client/simclient.ts';
import { findPoi, type Poi } from './client/poi.ts';
import type { PlanetView } from './client/worldview.ts';
import { qRotate, qRotateInv } from './client/orbits.ts';
import { Renderer } from './render/renderer.ts';
import { CameraRig } from './render/camera/rig.ts';
import { newInput, type InputState } from './render/camera/common.ts';
import { detectQuality, isQualityName, type QualityName } from './render/quality.ts';
import { pick, rayDirection, type PickHit } from './render/picking.ts';
import { Hud } from './ui/hud.ts';
import { Inspector } from './ui/inspector.ts';

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
    // the real sim in its worker is the default; ?source=lookdev is the render-dev generator, ?source=auto tries the
    // worker and falls back to lookdev (never silently: the HUD says so)
    source: src === 'lookdev' || src === 'auto' ? src : 'worker',
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

/** a thing in the world the camera can frame / follow and the inspector can show (`target` of a CameraSpec) */
export interface TargetRef { kind: 'agent' | 'building' | 'settlement' | 'animal'; id: number; planet?: number }

function hasBuildings(pv: PlanetView, settlement: number): boolean {
  const B = pv.buildings;
  if (B) for (let i = 0; i < B.count; i++) if (B.settlement[i] === settlement) return true;
  return false;
}

function isTargetRef(v: unknown): v is TargetRef {
  const o = v as TargetRef | null;
  return !!o && typeof o === 'object' && typeof o.id === 'number' && ['agent', 'building', 'settlement', 'animal'].includes(o.kind);
}

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly opts: AppOptions;
  readonly sim = new SimClient();
  renderer!: Renderer;
  readonly rig = new CameraRig();
  hud!: Hud;
  inspector!: Inspector;
  readonly input: InputState = newInput();
  /** the selected thing (inspector + marker) and the thing the camera follows */
  selected: EntityRef | null = null;
  following: EntityRef | null = null;
  private selEl: HTMLDivElement | null = null;
  private selName = '';
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
  /** last `focus` command sent (CONTRACT §8.7: the camera's dwelling point, the sim's default "here") */
  private focusSentAt = -1e9;
  private focusSent: [number, number, number] | null = null;
  private focusPlanet = -1;
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
      lookAt: (planet, pos) => this.lookAt(planet, pos),
      selectSettlement: (planet, id) => this.select({ kind: 'settlement', id, planet }),
    }, this.opts.dev);
    this.inspector = new Inspector(this.hud.root, {
      // the lookdev world is fabricated: nobody in it has a story to ask for
      query: (q, args) => (this.sim.source === 'lookdev' ? Promise.resolve({ lookdev: true }) : this.sim.query(q, args)),
      date: (planet, tick) => {
        const pv = this.sim.view.planet(planet);
        if (!pv) return '';
        const c = this.sim.view.calendar(pv, tick);
        return `Y${c.year} · d${c.day}`;
      },
      select: (ref) => this.select(ref),
      lookAt: (ref) => this.lookAtEntity(ref),
      follow: (ref) => this.follow(ref),
      isFollowing: (ref) => !!this.following && this.following.kind === ref.kind && this.following.id === ref.id,
    });
    this.selEl = document.createElement('div');
    this.selEl.className = 'gn-sel';
    this.selEl.hidden = true;
    this.selEl.innerHTML = '<div class="gn-sel-name"></div><div class="gn-sel-pin"></div>';
    this.hud.root.appendChild(this.selEl);
    // the scenario's setup (its founding, its first sea) is history, not news: no toasts until the first frames are up
    this.hud.toasts.enabled = false;
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
    if (this.sim.source === 'lookdev') this.hud.toast('Lookdev world: the simulation is not running here — a fabricated world for the look.', 6000);
    this.sim.view.pendingEvents.length = 0;
    this.hud.toasts.pump(this.sim.view, performance.now());
    this.hud.toasts.enabled = true;
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
      if (this.following) this.updateFollow(dt);
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
      this.sendFocus(now);
      this.fps = this.fps * 0.92 + (dt > 0 ? 1 / dt : 60) * 0.08;
      const life = this.renderer.planets.get(this.renderer.primaryId)?.life;
      this.hud.update({
        view, pose, stats: this.renderer.stats, fps: this.fps, primary: this.renderer.primaryId,
        systemView: this.rig.mode === 'system' || this.renderer.stats.altitude > 3e5,
        project: (s, out) => this.renderer.projectToScreen(s, pose, out), source: this.sim.source, snapshotHz: this.sim.snapshotHz,
        altitude: this.renderer.stats.altitude, selected: this.selected,
        groundRadius: (planet, u) => { const p = view.planet(planet); return p ? view.groundRadius(p, u[0], u[1], u[2]) : 0; },
        life: life && this.opts.dev ? {
          people: life.crowds.stats.agents, ambient: life.crowds.stats.ambient, animals: life.animals.stats.drawn,
          buildings: life.buildings.stats.instances, variants: life.buildings.stats.variants, pending: life.buildings.stats.pendingVariants,
          roads: life.roads.stats.chains,
        } : null,
      });
      this.hud.toasts.pump(view, now, this.renderer.primaryId);
      this.inspector.tick(now);
      this.updateMarker();
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
      case 'Escape':
        if (this.selected) { this.select(null); break; }
        if (this.rig.mode !== 'orbit') this.flyTo(this.renderer.primaryId >= 0 ? this.renderer.primaryId : 0);
        break;
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

  /**
   * What is drawn under a screen point on the primary world: a person, a herd or a building (the life layer's own
   * placements, so it is what the player sees), unless the ground is nearer.
   */
  pickEntity(x: number, y: number): (EntityRef & { dist: number }) | null {
    const pv = this.sim.view.planet(this.renderer.primaryId);
    const life = pv ? this.renderer.planets.get(pv.id)?.life : undefined;
    if (!pv || !life || this.rig.mode === 'system') return null;
    const ndcX = (x / window.innerWidth) * 2 - 1;
    const ndcY = 1 - (y / window.innerHeight) * 2;
    const dir = rayDirection(this.renderer.camera, ndcX, ndcY, [0, 0, 0]);
    const p = this.rig.pose.pos;
    const o = qRotateInv(pv.quat, [p[0] - pv.center[0], p[1] - pv.center[1], p[2] - pv.center[2]]);
    const d = qRotateInv(pv.quat, dir);
    const ground = pick(this.sim.view, this.rig.pose, dir);
    const maxT = ground && ground.planet === pv.id ? ground.dist + 2.5 : 4000;
    // a few pixels of grace around small, far figures
    const slack = ((this.rig.pose.fov * Math.PI) / 180 / Math.max(200, window.innerHeight)) * 7;
    const hit = life.pick(o, d, maxT, slack);
    return hit ? { kind: hit.kind, id: hit.id, planet: pv.id, dist: hit.t } : null;
  }

  /** a left click at a screen point (test surface) */
  clickAt(x: number, y: number): void { this.onClick(x, y); }

  /** people (or buildings) drawn near the camera and well inside the view right now, nearest first, with their screen positions (test surface) */
  drawnAgents(n: number, kind: 'agent' | 'building' = 'agent'): { id: number; dist: number; screen: [number, number] | null }[] {
    const pv = this.sim.view.planet(this.renderer.primaryId);
    const life = pv ? this.renderer.planets.get(pv.id)?.life : undefined;
    const A = kind === 'agent' ? pv?.agents : pv?.buildings;
    if (!pv || !life || !A) return [];
    const p = this.rig.pose.pos;
    const out: { id: number; dist: number; screen: [number, number] | null }[] = [];
    const W = window.innerWidth, H = window.innerHeight;
    for (let i = 0; i < A.count; i++) {
      // people asleep indoors are behind walls (a click there is on the house)
      if (kind === 'agent' && (A.flags[i] & AgentFlag.sleepingIndoors)) continue;
      const b = life.positionOf(kind, A.id[i]);
      if (!b) continue;
      const s = qRotate(pv.quat, b);
      const sys: [number, number, number] = [pv.center[0] + s[0], pv.center[1] + s[1], pv.center[2] + s[2]];
      const scr = this.renderer.projectToScreen(sys, this.rig.pose, this.v2);
      // on screen, clear of the edges and of the UI panels (the inspector opens on the right)
      if (!scr || scr.x < W * 0.12 || scr.x > W * 0.6 || scr.y < H * 0.2 || scr.y > H * 0.9) continue;
      out.push({ id: A.id[i], dist: Math.hypot(sys[0] - p[0], sys[1] - p[1], sys[2] - p[2]), screen: [scr.x, scr.y] });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, n);
  }

  private onClick(x: number, y: number): void {
    const ent = this.pickEntity(x, y);
    if (ent) { this.select({ kind: ent.kind, id: ent.id, planet: ent.planet }); return; }
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
    // clicking a settlement's ground selects the settlement; elsewhere it recentres the orbit (powers arrive with the
    // god layer) and lets go of the selection
    const pv = this.sim.view.planet(hit.planet);
    const st = pv ? this.settlementAt(pv, hit.dir) : null;
    if (st) { this.select({ kind: 'settlement', id: st, planet: hit.planet }); return; }
    if (this.selected) this.select(null);
    if (this.rig.mode === 'orbit') {
      const o = this.rig.orbit;
      o.focus = [hit.dir[0], hit.dir[1], hit.dir[2]];
    }
  }

  /** the settlement whose territory (or, for a band, whose camp) covers a point, or null */
  private settlementAt(pv: PlanetView, dir: ArrayLike<number>): number | null {
    const terr = pv.fields.get('territory');
    if (terr) {
      const c = pv.grid.nearestCell(dir[0], dir[1], dir[2]);
      const id = Math.round(terr[c]);
      if (id >= 0 && pv.settlements.some((s) => s.id === id)) return id;
    }
    const R = pv.params.radius;
    for (const s of pv.settlements) {
      const d = Math.acos(Math.min(1, s.pos[0] * dir[0] + s.pos[1] * dir[1] + s.pos[2] * dir[2])) * R;
      if (d < 35) return s.id;
    }
    return null;
  }

  // ── selection, follow, look ──

  /** select a thing (opens the inspector and the marker), or null to let go */
  select(ref: EntityRef | null): void {
    this.selected = ref ? { kind: ref.kind, id: ref.id, planet: ref.planet ?? this.renderer.primaryId } : null;
    if (this.following && (!ref || this.following.kind !== ref.kind || this.following.id !== ref.id)) this.following = null;
    this.inspector.open(this.selected);
    this.selName = '';
  }

  /** keep the camera on a thing (null stops); an orbit camera is used, at its current distance */
  follow(ref: EntityRef | null): void {
    this.following = ref ? { kind: ref.kind, id: ref.id, planet: ref.planet ?? this.renderer.primaryId } : null;
    if (!ref) return;
    const pv = this.sim.view.planet(this.following!.planet!);
    const b = pv ? this.entityBodyPos(pv, this.following!) : null;
    if (!pv || !b) return;
    if (this.rig.mode !== 'orbit' || this.rig.orbit.planet !== pv.id) {
      const l = Math.hypot(b[0], b[1], b[2]);
      this.rig.orbit.planet = pv.id;
      this.rig.orbit.focus = [b[0] / l, b[1] / l, b[2] / l];
      this.rig.orbit.dist = Math.min(this.rig.orbit.dist, 120);
      this.rig.orbit.tiltFixed = 58;
      this.rig.use(this.rig.orbit, 1.2);
    }
  }

  private updateFollow(dt: number): void {
    const f = this.following!;
    const pv = this.sim.view.planet(f.planet ?? -1);
    const b = pv ? this.entityBodyPos(pv, f) : null;
    if (!pv || !b || this.rig.orbit.planet !== pv.id) return;
    const l = Math.hypot(b[0], b[1], b[2]) || 1;
    const fo = this.rig.orbit.focus;
    // ease toward them (a person walks on; a snap every snapshot would shake the view)
    const k = 1 - Math.exp(-dt * 5);
    fo[0] += (b[0] / l - fo[0]) * k; fo[1] += (b[1] / l - fo[1]) * k; fo[2] += (b[2] / l - fo[2]) * k;
    const fl = Math.hypot(fo[0], fo[1], fo[2]) || 1;
    fo[0] /= fl; fo[1] /= fl; fo[2] /= fl;
  }

  /**
   * Body-frame position (m) of a thing on a planet: where the life layer drew it this frame when it did, else from
   * the snapshot blocks (on the ground).
   */
  entityBodyPos(pv: PlanetView, ref: EntityRef): [number, number, number] | null {
    const life = this.renderer.planets.get(pv.id)?.life;
    const drawn = life?.positionOf(ref.kind, ref.id);
    if (drawn) return drawn;
    let u: ArrayLike<number> | null = null;
    let lift = 0;
    if (ref.kind === 'settlement') {
      const s = pv.settlements.find((q) => q.id === ref.id);
      if (s) u = s.pos;
      lift = 6;
      // a band on the move, or a camp with nothing built yet, is where its people are (its recorded place is where
      // the leader was heading, or the cell it was founded on while they still gather there)
      const A = pv.agents;
      if (s && A && ((s.flags & 1) || !hasBuildings(pv, s.id))) {
        let x = 0, y = 0, z = 0, n = 0;
        for (let i = 0; i < A.count; i++) if (A.group[i] === s.id) { x += A.pos[i * 3]; y += A.pos[i * 3 + 1]; z += A.pos[i * 3 + 2]; n++; }
        if (n) u = [x, y, z];
        lift = 2;
      }
    }
    else if (ref.kind === 'agent' || ref.kind === 'animal') {
      const M = ref.kind === 'agent' ? pv.agents : pv.animals;
      if (M) for (let i = 0; i < M.count; i++) {
        if ((ref.kind === 'agent' ? M.id[i] : M.group[i]) !== ref.id) continue;
        const dt = (pv.renderTick ?? pv.paramsTick) - pv.paramsTick;
        u = [M.pos[i * 3] + M.vel[i * 3] * dt, M.pos[i * 3 + 1] + M.vel[i * 3 + 1] * dt, M.pos[i * 3 + 2] + M.vel[i * 3 + 2] * dt];
        // fliers are framed in the air where they are (a flying flock was framed as the ground under it)
        lift = 2 + Math.max(0, M.alt[i] ?? 0);
        break;
      }
    } else if (ref.kind === 'building') {
      const B = pv.buildings;
      if (B) for (let i = 0; i < B.count; i++) if (B.id[i] === ref.id) { u = [B.pos[i * 3], B.pos[i * 3 + 1], B.pos[i * 3 + 2]]; lift = 5; break; }
    }
    if (!u) return null;
    const l = Math.hypot(u[0], u[1], u[2]) || 1;
    const r = this.sim.view.groundRadius(pv, u[0] / l, u[1] / l, u[2] / l) + lift;
    return [(u[0] / l) * r, (u[1] / l) * r, (u[2] / l) * r];
  }

  /** fly the orbit camera to a place on a world (a toast, the inspector's "Look") */
  lookAt(planet: number, pos: ArrayLike<number>, dist?: number): void {
    const pv = this.sim.view.planet(planet);
    if (!pv) return;
    const l = Math.hypot(pos[0], pos[1], pos[2]) || 1;
    const o = this.rig.orbit;
    const cur = this.rig.mode === 'orbit' && o.planet === planet ? o.dist : 1e9;
    o.planet = planet;
    o.focus = [pos[0] / l, pos[1] / l, pos[2] / l];
    o.dist = dist ?? (cur < 700 ? cur : 260);
    o.tiltFixed = o.tiltFixed ?? 55;
    this.rig.use(o, 1.4);
  }

  lookAtEntity(ref: EntityRef): void {
    const pv = this.sim.view.planet(ref.planet ?? this.renderer.primaryId);
    const b = pv ? this.entityBodyPos(pv, ref) : null;
    if (!pv || !b) return;
    this.lookAt(pv.id, b, ref.kind === 'settlement' ? 240 : ref.kind === 'building' ? 70 : 28);
  }

  /** the marker over the selected thing: projected every frame; hidden when off screen or not placeable */
  private updateMarker(): void {
    const el = this.selEl;
    if (!el) return;
    const ref = this.selected;
    const pv = ref ? this.sim.view.planet(ref.planet ?? -1) : undefined;
    const b = ref && pv && this.rig.mode !== 'system' ? this.entityBodyPos(pv, ref) : null;
    if (!ref || !pv || !b) { el.hidden = true; return; }
    const s = qRotate(pv.quat, b);
    const p = this.renderer.projectToScreen([pv.center[0] + s[0], pv.center[1] + s[1], pv.center[2] + s[2]], this.rig.pose, this.v2);
    if (!p || p.x < -40 || p.y < -40 || p.x > window.innerWidth + 40 || p.y > window.innerHeight + 40) { el.hidden = true; return; }
    el.hidden = false;
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${(p.y - 6).toFixed(1)}px) translate(-50%, -100%)`;
    const nameEl = this.inspector.root.querySelector('.gn-insp-name');
    const name = nameEl?.textContent && nameEl.textContent !== '…' ? nameEl.textContent : '';
    if (name !== this.selName) { this.selName = name; (el.firstElementChild as HTMLElement).textContent = name; }
  }

  /**
   * Tell the sim where the camera dwells (a logged `focus` command, so determinism holds): it is the default place for
   * commands given without one ("rain here") and, later, where cohorts are promoted to individuals. At most every
   * 2.5 s, and only when the point moved more than ~1° or the world changed.
   */
  private sendFocus(now: number): void {
    if (now - this.focusSentAt < 2500 || !this.sim.backend) return;
    const mode = this.rig.mode;
    if (mode === 'system') return;
    const pv = this.sim.view.planet(this.rig.pose.planet >= 0 ? this.rig.pose.planet : this.renderer.primaryId);
    if (!pv) return;
    let d: [number, number, number];
    if (mode === 'orbit' && this.rig.orbit.planet === pv.id) {
      const f = this.rig.orbit.focus;
      d = [f[0], f[1], f[2]];
    } else {
      const p = this.rig.pose.pos;
      d = rotate([-pv.quat[0], -pv.quat[1], -pv.quat[2], pv.quat[3]], [p[0] - pv.center[0], p[1] - pv.center[1], p[2] - pv.center[2]]);
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      d = [d[0] / l, d[1] / l, d[2] / l];
    }
    const last = this.focusSent;
    if (last && this.focusPlanet === pv.id && last[0] * d[0] + last[1] * d[1] + last[2] * d[2] > Math.cos(0.0175)) return;
    this.focusSentAt = now;
    this.focusSent = d;
    this.focusPlanet = pv.id;
    void this.sim.cmd({ k: 'focus', planet: pv.id, pos: d });
  }

  // ── actions (HUD, keys, test surface) ──

  setSpeed(x: number): void { this.sim.setSpeed(Math.max(0, x)); }
  private stepSpeed(d: number): void {
    const presets = [0, 1, 10, 100, 1000];
    const i = presets.indexOf(this.sim.view.speed);
    this.setSpeed(presets[Math.max(0, Math.min(presets.length - 1, (i < 0 ? 1 : i) + d))]);
  }
  async step(ticks: number): Promise<number> {
    const t = await this.sim.step(ticks);
    this.freshAfter = performance.now();
    return t;
  }
  /**
   * real time after which a snapshot reflects the last command / step (the worker answers in order, so a snapshot
   * that arrives after their reply was taken after them); camera framing of things in the world waits for one
   */
  private freshAfter = 0;
  private async waitFresh(timeoutMs = 15000): Promise<void> {
    if (this.sim.view.snapAt > this.freshAfter) return;
    // ask now and wait for that answer (not for frames: a software-rendered frame can take longer than the timeout)
    await Promise.race([this.sim.fresh(), new Promise<void>((ok) => setTimeout(ok, timeoutMs))]);
  }
  /** run a command; what it did (or why not) is a toast, except for the camera's own bookkeeping */
  async cmd(c: Command): Promise<CommandResult> {
    const r = await this.sim.cmd(c);
    if (c.k !== 'focus') this.freshAfter = performance.now();
    if (c.k !== 'focus' && !c.k.startsWith('time.') && r.msg && r.msg !== 'queued for the next tick') this.hud.toast(r.msg, r.ok ? 5200 : 6500, r.ok ? 'info' : 'warn');
    return r;
  }

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
    // clean frames (trailer stills, photo mode, __GENESIS__.ui(false)) hide the ForgeFlow portal bar too (styles.css)
    document.body.classList.toggle('genesis-clean', !v);
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
    // frame the world as it is after the commands and steps that came before (not the snapshot in flight then)
    if (spec.target || spec.poi) await this.waitFresh();
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
    if (isTargetRef(spec.target) && pv) {
      // a thing in the world: wait (briefly) for a snapshot that has it, then centre on it
      const ref: EntityRef = { kind: spec.target.kind, id: spec.target.id, planet: spec.target.planet ?? pv.id };
      let b = this.entityBodyPos(pv, ref);
      for (let i = 0; i < 60 && !b; i++) { await this.waitFrames(1); b = this.entityBodyPos(this.sim.view.planet(pv.id) ?? pv, ref); }
      if (b) {
        const l = Math.hypot(b[0], b[1], b[2]);
        lat = (Math.asin(Math.max(-1, Math.min(1, b[1] / l))) * 180) / Math.PI;
        lon = (Math.atan2(b[0], b[2]) * 180) / Math.PI;
        heading = (spec.yaw ?? 0) + (spec.turn ?? 0);
      }
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
      const tilt = spec.tilt ?? (spec.pitch != null ? 90 + spec.pitch : null);
      // near the ground, turn until the hillside behind the camera does not block the view of the place
      if (pv && dist < 600 && (spec.poi || spec.target)) heading = this.clearHeading(pv, lat, lon, dist, tilt ?? this.rig.orbit.autoTilt(dist), heading);
      this.rig.orbit.setFromLatLon(planet, lat, lon, dist, heading, tilt);
      if (spec.fov) this.rig.orbit.fov = spec.fov;
      this.rig.use(this.rig.orbit, blend);
    }
    if (blend === 0) this.renderer?.cut();
    let hour = spec.hour;
    if (spec.sunElevation != null && pv) {
      // solve the hour angle for the wanted elevation with the sun's current declination (evening branch)
      const sunB = rotate([-pv.quat[0], -pv.quat[1], -pv.quat[2], pv.quat[3]], pv.sunDir);
      const dec = Math.asin(Math.max(-1, Math.min(1, sunB[1])));
      const phi = (lat * Math.PI) / 180, el = (spec.sunElevation * Math.PI) / 180;
      const cosH = (Math.sin(el) - Math.sin(phi) * Math.sin(dec)) / Math.max(1e-6, Math.cos(phi) * Math.cos(dec));
      const H = Math.acos(Math.max(-1, Math.min(1, cosH)));
      // planet hours: local noon is half a day, whatever the day length (Cinder's day is 30 h)
      const half = pv.params.dayHours / 2;
      hour = half + (H / Math.PI) * half;
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
        const sun = rotate([-pvs.quat[0], -pvs.quat[1], -pvs.quat[2], pvs.quat[3]], pvs.sunDir);
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

  /**
   * A heading (deg) for an orbit view of a place from which the eye is clear of the ground and nothing rises between
   * it and the place: the wanted heading if it works, else the nearest of 16 directions that does (the most open one
   * when none does). An orbit eye under a hillside would otherwise be pushed up to 2 m over the slope, staring into it.
   */
  private clearHeading(pv: PlanetView, latDeg: number, lonDeg: number, dist: number, tiltDeg: number, headingDeg: number): number {
    const d2r = Math.PI / 180;
    const la = latDeg * d2r, lo = lonDeg * d2r;
    const f: [number, number, number] = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
    let ex = f[2], ez = -f[0];
    const el = Math.hypot(ex, ez) || 1;
    ex /= el; ez /= el;
    const nx = f[1] * ez, ny = f[2] * ex - f[0] * ez, nz = -f[1] * ex;
    const gF = this.sim.view.groundRadius(pv, f[0], f[1], f[2]) + 1.2;
    const tl = tiltDeg * d2r;
    // tree crowns (the vegetation layer stands up to ~20 m over cells with tree cover) block a low view too
    const tree = pv.fields.get('tree');
    const clearance = (hd: number): number => {
      const h = hd * d2r;
      const bx = -(nx * Math.cos(h) + ex * Math.sin(h)), by = -(ny * Math.cos(h)), bz = -(nz * Math.cos(h) + ez * Math.sin(h));
      let worst = Infinity;
      // along the sight line from the place (k = 0) to the eye (k = 1)
      for (let k = 1; k <= 6; k++) {
        const s = (k / 6) * dist;
        const back = Math.sin(tl) * s, up = Math.cos(tl) * s;
        let px = f[0] * gF + bx * back, py = f[1] * gF + by * back, pz = f[2] * gF + bz * back;
        const r0 = Math.hypot(px, py, pz);
        const r = r0 + up;
        px /= r0; py /= r0; pz /= r0;
        const canopy = tree && k >= 2 ? Math.min(1, pv.grid.sample(tree, px, py, pz) * 2.2) * 18 : 0;
        worst = Math.min(worst, r - this.sim.view.groundRadius(pv, px, py, pz) - canopy);
      }
      return worst;
    };
    const need = Math.min(6, dist * Math.cos(tl) * 0.35 + 1);
    if (clearance(headingDeg) >= need) return headingDeg;
    let best = headingDeg, bc = -Infinity;
    for (let i = 1; i <= 8; i++) for (const sgn of [1, -1]) {
      const hd = headingDeg + sgn * i * 22.5;
      const c = clearance(hd);
      if (c >= need) return hd;
      if (c > bc) { bc = c; best = hd; }
    }
    return best;
  }

  /** URL ?cam= presets */
  async applyCameraPreset(name: string): Promise<void> {
    const presets: Record<string, CameraSpec> = {
      // the sun 60–75° off the view axis (mid-afternoon at the camera's meridian): the terminator in frame, relief in
      // raking light — a sun behind the camera reads every world as a flat, evenly lit disc
      orbit: { mode: 'orbit', lat: 18, lon: -35, dist: 7800, hour: 16.25 },
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
      selected: this.selected, following: this.following,
      life: (() => {
        const l = this.renderer.planets.get(this.renderer.primaryId)?.life;
        return l ? { people: l.crowds.stats.agents, ambient: l.crowds.stats.ambient, animals: l.animals.stats.drawn, buildings: l.buildings.stats.instances, pendingVariants: l.buildings.stats.pendingVariants, roads: l.roads.stats.chains } : null;
      })(),
    };
  }

  /** a point of interest on the primary world (test surface: where to put a people, where to look) */
  poi(name: string, planet?: number): (Poi & { pos: UnitVec; planet: number }) | null {
    const pv = this.sim.view.planet(planet ?? (this.renderer.primaryId >= 0 ? this.renderer.primaryId : this.sim.view.planets[0]?.id ?? 0));
    if (!pv) return null;
    const p = findPoi(pv, name);
    if (!p) return null;
    const P = pv.grid.pos;
    return { ...p, planet: pv.id, pos: [P[p.cell * 3], P[p.cell * 3 + 1], P[p.cell * 3 + 2]] };
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
