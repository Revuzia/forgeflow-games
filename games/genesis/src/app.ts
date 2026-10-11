// GENESIS — the App (CONTRACT.md §3): owns the SimClient, the Renderer, the camera rig, the UI shell, the audio and
// input, and runs the frame loop. The sim runs at a fixed tick rate in its worker (or the lookdev generator); this loop
// is variable rate: per animation frame the UI turns held keys and the gamepad into camera input, the render clock
// advances, the camera moves, the world renders, the sim is asked for the next snapshot (≤ 30 Hz), and the UI follows
// the world on screen. Errors inside a frame are counted; persistent failure raises the fatal card.
//
// The App is the UI's host (src/ui/host.ts): every UI action is a Command to the sim or a camera action here. Pointer
// and keyboard input go to the shell (src/ui/shell.ts), which decides between a gesture, the armed tool, the hand and
// the camera; a plain click comes back here to select what is drawn there (src/ui/inspector.ts), and a marker floats
// over the selection. The sim's events and chronicle become toasts (src/ui/toasts.ts) and sound (src/audio/**).

import { setPanelSound } from './ui/panel.ts';
import { Vector2, type IUniform } from 'three';
import type { Command, CommandResult, EntityRef, UnitVec } from './sim/types.ts';
import type { ContentPack } from './sim/content.ts';
import { AgentFlag } from './sim/types.ts';
import { SimClient } from './client/simclient.ts';
import { findPoi, type Poi } from './client/poi.ts';
import type { PlanetView } from './client/worldview.ts';
import { qMul, qRotate, qRotateInv } from './client/orbits.ts';
import { tangentBasis } from './sim/core/vec3.ts';
import { Renderer } from './render/renderer.ts';
import { CameraRig } from './render/camera/rig.ts';
import { newInput, type InputState } from './render/camera/common.ts';
import { detectQuality, isQualityName, QUALITY, type QualityName } from './render/quality.ts';
import { pick, rayDirection, type PickHit } from './render/picking.ts';
import type { GenesisAudio } from './audio/engine.ts';
import { Shell } from './ui/shell.ts';
import type { GroundHit, InspectRef, UiHost, CameraHost, CameraModeName, PhotoLens, RenderCameraModes } from './ui/host.ts';
import { WalkCamera, DollyDriver } from './ui/camfallback.ts';
import { defaultLens } from './ui/photo.ts';
import { ModLibrary, bootPacks, validatePacks, type BootProblem } from './ui/mods.ts';
import { customScenarioPack, decodeWorlds, type CustomSpec } from './ui/newworld.ts';
import { SaveStore, readSaveHeader, neededPacks, type LoadOutcome, type SaveRecord, type PackRef } from './ui/saves.ts';
import { BASE_PACK } from './data/index.ts';
import type { StarDef, PlanetKindDef } from './sim/content.ts';
import type { CameraController } from './render/camera/common.ts';
import { PowerBook } from './ui/powers.ts';
import { Keybinds } from './ui/keybinds.ts';
import { PrefsStore } from './ui/prefs.ts';
import type { ToastSpec, ToastAction } from './ui/toasts.ts';
import { store } from './ui/dom.ts';
import { humanize, tollOf } from './ui/words.ts';

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
  /** your own system (?scenario=custom&star=K&worlds=terran:plains-folk:stone,desert:hive:stone) */
  custom: CustomSpec | null;
  /** mod packs from the library by id (?mods=a,b) and from addresses (?mod=<url>, repeatable) */
  mods: string[];
  modUrls: string[];
  /** open a saved slot in a fresh simulation (?load=<slot id>) */
  load: string | null;
}

export function parseParams(search: string): AppOptions {
  const p = new URLSearchParams(search);
  const q = p.get('quality');
  const src = p.get('source');
  const num = (k: string, d: number) => { const v = Number(p.get(k)); return p.has(k) && Number.isFinite(v) ? v : d; };
  return {
    // a new player begins on the barren world with the opening (CONTRACT §16.1); the lookdev world is the render
    // lane's test scene: chosen by name, by ?source=lookdev, or by a harness that skips the opening (?intro=0)
    scenario: p.get('scenario') ?? (src === 'lookdev' || p.get('intro') === '0' ? 'lookdev' : 'barren'),
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
    custom: p.get('scenario') === 'custom' ? { star: p.get('star') || 'G', worlds: decodeWorlds(p.get('worlds') || 'terran:plains-folk:stone') } : null,
    mods: (p.get('mods') ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    modUrls: p.getAll('mod').map((x) => x.trim()).filter(Boolean),
    load: p.get('load'),
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
export interface TargetRef { kind: 'agent' | 'building' | 'settlement' | 'animal' | 'creature' | 'disaster' | 'ship' | 'weather'; id: number; planet?: number }

function hasBuildings(pv: PlanetView, settlement: number): boolean {
  const B = pv.buildings;
  if (B) for (let i = 0; i < B.count; i++) if (B.settlement[i] === settlement) return true;
  return false;
}

function isTargetRef(v: unknown): v is TargetRef {
  const o = v as TargetRef | null;
  return !!o && typeof o === 'object' && typeof o.id === 'number' && ['agent', 'building', 'settlement', 'animal', 'creature', 'disaster', 'ship', 'weather'].includes(o.kind);
}

/** acts whose harm comes after the cast (an Undo is offered on their toast whatever the first toll) */
const DESTRUCTIVE = /^(disaster\.spawn|miracle\.(lightning|fireball|meteor|fire)|fire\.(ignite|firestorm)|settlement\.(raze|start-war)|agent\.kill|life\.(cull|kill|extinct|curse)|world\.(erase|crack|moon-fall)|water\.(flood|tsunami)|terrain\.crater)$/;

/** the audio module (src/audio/**, its own lane), loaded lazily so a world without sound still runs */
const AUDIO_MODULE = import.meta.glob<{ createAudio: (o?: Record<string, unknown>) => GenesisAudio }>('./audio/engine.ts');

export class App implements UiHost {
  readonly canvas: HTMLCanvasElement;
  readonly opts: AppOptions;
  readonly sim = new SimClient();
  renderer!: Renderer;
  readonly rig = new CameraRig();
  ui!: Shell;
  readonly input: InputState = newInput();
  readonly powers = new PowerBook();
  readonly keybinds = new Keybinds(store);
  readonly prefs = new PrefsStore();
  audio: GenesisAudio | null = null;
  private audioCues = new Set<string>();
  /** the selected thing (inspector + marker) and the thing the camera follows */
  private sel: InspectRef | null = null;
  following: EntityRef | null = null;
  private selEl: HTMLDivElement | null = null;
  private selName = '';
  onFatal: ((title: string, err: unknown) => void) | null = null;
  quality: QualityName = 'high';
  private autoQuality: QualityName = 'high';
  fps = 60;
  /** the last frame's real duration (s), unclamped: the frame rate shown is the true one */
  frameSec = 1 / 60;
  frames = 0;
  private last = 0;
  private startAt = 0;
  private raf = 0;
  private running = false;
  private frameErrors = 0;
  private captureWaiters: ((url: string) => void)[] = [];
  private frameWaiters: { n: number; ok: () => void }[] = [];
  private hover: PickHit | null = null;
  private hoverAt: [number, number] = [-1, -1];
  private uiVisible = true;
  /** last `focus` command sent (CONTRACT §8.7: the camera's dwelling point, the sim's default "here") */
  private focusSentAt = -1e9;
  private focusSent: [number, number, number] | null = null;
  private focusPlanet = -1;
  private v2 = new Vector2();
  private powersAt = -1e9;
  /** a ring over what the hand would take (until the render lane draws a hover outline) */
  private hoverEl: HTMLDivElement | null = null;
  /** the cloud march's own density scale, kept while an overlay thins it */
  private cloudZ: number | null = null;
  // ── content packs (mods, your own system) ──
  readonly library = new ModLibrary();
  /** the content packs this world was made with or took since, beyond the base (their JSON: saves carry them) */
  packs: ContentPack[] = [];
  private bootProblems: BootProblem[] = [];
  private bootNotes: string[] = [];
  /** the world now: its scenario ('custom' for your own system) and seed (a loaded save changes them) */
  private world = { scenario: '', seed: 0 };
  // ── camera modes (CONTRACT §15.8): the render lane's when bound, else the fallbacks (src/ui/camfallback.ts) ──
  /** the render lane's follow / dolly / walk / photo, bound by the integration step (empty: every mode falls back) */
  modeApi: RenderCameraModes = {};
  private walkCam = new WalkCamera();
  private dollyDrv = new DollyDriver();
  private camMode: 'walk' | 'dolly' | 'photo' | null = null;
  private camSubject: InspectRef | null = null;
  private photoPrev: { ctrl: CameraController; ui: boolean; speed: number; walk: boolean } | null = null;
  private lensState: PhotoLens = defaultLens();
  private lensInit = false;
  private photoFrozen = true;
  /** the interface's visibility before the cinematic hid it */
  private cineUi: boolean | null = null;
  /** the look: the settings' values, and the opening's light on top */
  private look = { exposure: 0, bloom: 0.045, vignette: 0.22, grain: 0.02 };
  private fx = { ev: 0, bloom: 1 };
  /** the opening: seconds the world still turns under the camera, and the orbit lines it hid */
  private turnT = 0;
  private orbitsShown: boolean | null = null;

  /** the camera modes, as the interface asks for them (src/ui/host.ts CameraHost) */
  readonly cam: CameraHost = {
    mode: () => this.camModeName(),
    subject: () => (this.camMode ? this.camSubject : this.following ? { ...this.following } : null),
    dolly: (ref) => this.dolly(ref),
    walk: (ref, leave) => this.walk(ref, leave),
    photo: (on) => this.photo(on),
    lens: () => this.lensState,
    setLens: (p) => this.setLens(p),
    realDof: () => !!this.modeApi.dof,
    depthAt: (x, y) => this.pickGround(x, y)?.dist ?? null,
    grab: () => this.capture(),
    frozen: () => this.photoFrozen,
    freeze: (on) => this.freeze(on),
    stick: (x, y) => { this.walkCam.stickX = x; this.walkCam.stickY = y; },
  };

  constructor(canvas: HTMLCanvasElement, opts: AppOptions) {
    this.canvas = canvas;
    this.opts = opts;
  }

  get view() { return this.sim.view; }
  get source(): string { return this.sim.source; }
  get selected_(): InspectRef | null { return this.sel; }

  async start(progress: (msg: string, frac: number) => void): Promise<void> {
    progress('Lighting the star…', 0.08);
    this.renderer = new Renderer(this.canvas);
    const gl = this.renderer.three.getContext() as WebGL2RenderingContext;
    this.autoQuality = detectQuality(gl);
    this.quality = this.opts.quality === 'auto' ? (this.prefs.value.quality === 'auto' ? this.autoQuality : this.prefs.value.quality) : this.opts.quality;
    this.renderer.setQuality(this.quality);
    this.renderer.settings.exposureBias = this.opts.exposure;
    this.applyGraphics();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    progress('Forming the worlds…', 0.22);
    this.sim.onFatal = (msg) => this.onFatal?.('the simulation stopped', msg);
    const boot = await this.bootWorld();
    await this.startSim(boot);
    progress('Gathering the air…', 0.62);
    this.sim.setSpeed(this.opts.speed);
    void this.loadPowers();
    const uiRoot = document.getElementById('ui') ?? document.body;
    this.ui = new Shell(uiRoot, {
      host: this,
      input: this.input,
      cameraMode: () => this.rig.mode,
      camera: {
        system: () => { if (this.rig.mode === 'system') this.flyTo(this.renderer.primaryId >= 0 ? this.renderer.primaryId : 0); else this.systemView(); },
        fly: () => this.toggleFly(),
        home: () => this.flyTo(this.renderer.primaryId >= 0 ? this.renderer.primaryId : 0),
        follow: () => { const s = this.sel; if (s && s.kind !== 'species' && s.kind !== 'cell' && s.kind !== 'planet') this.follow(this.isFollowing(s as EntityRef) ? null : s as EntityRef); },
        look: () => { const s = this.sel; if (s && s.kind !== 'species') this.lookAtEntity(s as EntityRef); },
      },
      click: (x, y) => this.onClick(x, y),
      setUi: (v) => this.setUi(v),
      uiVisible: () => this.uiVisible,
      setBrush: (b) => this.renderer.setBrush(b),
      uniformsOf: (id) => (this.renderer.planets.get(id)?.uniforms as unknown as Record<string, IUniform>) ?? null,
      save: () => this.saveBytes(),
      load: (b, packs) => this.loadSave(b, packs),
      thumb: () => this.thumb(),
      audioReady: () => !!this.audio,
      dev: this.opts.dev,
      hudFrame: () => this.hudFrame(),
      openingCamera: (shot) => this.openingCamera(shot),
      openingLight: (ev, bloom) => { this.fx.ev = ev; this.fx.bloom = bloom; },
      audioRunning: () => { try { return !!this.audio?.state().running; } catch { return false; } },
      world: () => this.world,
      packs: () => this.packs,
      library: this.library,
      addPack: (pk) => this.addPack(pk),
      bootProblems: () => this.bootProblems,
      reloadInto: (id) => { location.search = this.keepParams({ load: id }); },
      leaveFor: (url) => { location.search = url.startsWith('?') ? url.slice(1) : url; return new Promise<void>(() => { /* the page goes */ }); },
      canvas: this.canvas,
      localHour: () => this.localHour(),
      setLocalHour: (hh) => void this.setLocalHour(hh),
      cloudFade: (k) => {
        // a map overlay thins the clouds away: their density (uCloudScale.z, read live by the cloud march — a
        // planet-wide storm's bands too) and their coverage bias (uCloudScale.w: the weather bake and the shadows)
        const u = this.renderer.clouds.shared.uCloudScale.value;
        const f = Math.max(0, Math.min(1, k));
        this.cloudZ ??= u.z;
        // (a planet-wide storm's coverage runs past 1: the bias takes it away too)
        u.z = this.cloudZ * (1 - 0.985 * f);
        u.w = -1.6 * f;
      },
    });
    this.hoverEl = document.createElement('div');
    this.hoverEl.className = 'gn-hoverring';
    this.hoverEl.hidden = true;
    this.ui.hud.world.appendChild(this.hoverEl);
    this.selEl = document.createElement('div');
    this.selEl.className = 'gn-sel';
    this.selEl.hidden = true;
    this.selEl.innerHTML = '<div class="gn-sel-name"></div><div class="gn-sel-pin"></div>';
    this.ui.hud.world.appendChild(this.selEl);
    this.prefs.onChange((_p, what) => {
      if (what === '*' || what === 'quality' || what.startsWith('gfx')) this.applyGraphics();
      if (what === '*' || what.startsWith('audio')) this.applyAudio();
    });
    // the scenario's setup (its founding, its first sea) is history, not news: no toasts until the first frames are up
    this.ui.hud.toasts.enabled = false;
    this.setUi(this.opts.ui);
    this.installInput();
    void this.startAudio();
    // the render lane's camera modes (render/camera/modes.ts: follow, dolly, walk in the god's body, photo with real
    // depth of field) bound to the interface's camera host; walking among the people tells the sim they saw the god
    this.modeApi = this.rig.modes;
    this.rig.modes.onSeen = (e) => { void this.cmd({ k: 'god.seen', planet: e.planet, pos: e.pos, radius: e.radius }, { quiet: true }); };
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
    if (this.sim.source === 'lookdev') this.toast({ text: 'Lookdev world: the simulation is not running here — a fabricated world for the look.', ms: 6000 });
    this.sim.view.pendingEvents.length = 0;
    this.ui.hud.toasts.pump(this.sim.view, performance.now());
    this.ui.hud.toasts.enabled = true;
    // a new game on the barren world begins with the opening (§16.1); ?intro=0 skips it
    if (this.opts.intro && boot.scenario === 'barren' && !boot.slot && this.sim.source === 'worker' && !this.opts.cam) this.ui.opening.start();
    // what the packs asked for at boot did, in words (a pack left out says why; Mods lists it too)
    for (const n of this.bootNotes) this.toast({ text: n, kind: 'info' });
    for (const p of this.bootProblems) this.toast({ text: `Left out: ${p.what}. ${p.msg}${p.problems.length ? ` (${p.problems.slice(0, 2).join('; ')}${p.problems.length > 2 ? ' …' : ''})` : ''}`, kind: 'warn', ms: 12000 });
    if (boot.slot && !this.bootProblems.some((p) => p.what.startsWith('the save'))) this.toast({ text: `Returned to: ${boot.slot.name}.`, kind: 'info' });
  }

  /**
   * What the world is made of: a saved slot (?load=: a fresh simulation with exactly the save's packs, then the save),
   * or the scenario (your own system: its scenario written as a pack) with the library's packs (?mods=) and packs at
   * addresses (?mod=). Every pack is checked first; one that fails is left out and said why.
   */
  private async bootWorld(): Promise<{ scenario: string; packs: ContentPack[]; slot: SaveRecord | null }> {
    const o = this.opts;
    this.world = { scenario: o.custom ? 'custom' : o.scenario, seed: o.seed };
    if (o.load) {
      const slot = (await new SaveStore().get(o.load).catch(() => undefined)) ?? null;
      if (slot) return { scenario: 'barren', packs: [...(slot.packJson ?? [])], slot };
      this.bootProblems.push({ what: 'the saved world', msg: 'That save is no longer kept in this browser; a barren world begins instead.', problems: [] });
      this.world.scenario = 'barren';
      return { scenario: 'barren', packs: [], slot: null };
    }
    if (o.source === 'lookdev') return { scenario: o.scenario, packs: [], slot: null };
    const { packs, problems, notes } = await bootPacks(o.mods, o.modUrls, this.library);
    this.bootProblems.push(...problems);
    this.bootNotes.push(...notes);
    let scenario = o.scenario;
    if (o.custom) {
      // (stars and kinds of world from the packs too: a mod's star can light your own system)
      const all = [BASE_PACK, ...packs];
      const stars = all.flatMap((p) => (p.stars ?? []) as StarDef[]);
      const kinds = all.flatMap((p) => (p.planetkinds ?? []) as PlanetKindDef[]);
      const pack = customScenarioPack(o.custom, stars, kinds);
      const bad = validatePacks([...packs, pack]);
      if (bad) { this.bootProblems.push({ what: 'your own system', msg: `${bad.msg}; a barren world begins instead`, problems: bad.problems }); scenario = 'barren'; this.world.scenario = 'barren'; }
      else { packs.push(pack); scenario = pack.scenarios![0].id; }
    }
    return { scenario, packs, slot: null };
  }

  private async startSim(boot: { scenario: string; packs: ContentPack[]; slot: SaveRecord | null }): Promise<void> {
    const base = { source: this.opts.source, seed: this.opts.seed };
    try {
      await this.sim.start({ ...base, scenario: boot.scenario, options: boot.packs.length ? { mods: boot.packs } : {} });
    } catch (e) {
      if (!boot.packs.length || this.opts.source === 'lookdev') throw e;
      // packs that passed every check still broke the world: begin without them, and say so
      this.bootProblems.push({ what: 'the mod packs', msg: `The world could not be made with them (${e instanceof Error ? e.message : String(e)}); it began without them.`, problems: [] });
      boot.packs = [];
      boot.scenario = this.opts.custom || boot.slot ? 'barren' : this.opts.scenario;
      this.world.scenario = boot.scenario;
      boot.slot = null;
      await this.sim.start({ ...base, scenario: boot.scenario });
    }
    this.packs = [...boot.packs];
    if (boot.slot) {
      const r = await this.sim.load(boot.slot.bytes.slice(0));
      if (r.ok) {
        const hdr = readSaveHeader(boot.slot.bytes);
        this.world = { scenario: hdr.scenario.startsWith('custom') ? 'custom' : hdr.scenario, seed: hdr.seed };
        // the first snapshot after the load is the save's world
        await this.sim.fresh();
      } else {
        this.bootProblems.push({ what: `the save '${boot.slot.name}'`, msg: r.msg ?? 'it would not open', problems: [] });
      }
    }
  }

  /** this page's address with some parameters set (the quality, dev and source switches are kept, the rest dropped) */
  private keepParams(set: Record<string, string>): string {
    const old = new URLSearchParams(location.search);
    const p = new URLSearchParams();
    for (const k of ['quality', 'dev', 'source']) { const v = old.get(k); if (v !== null) p.set(k, v); }
    for (const [k, v] of Object.entries(set)) p.set(k, v);
    return p.toString();
  }

  /** a content pack for the living world (the Mods panel): added now, kept for the next world, or refused */
  private async addPack(pack: ContentPack): Promise<CommandResult> {
    if (this.sim.source !== 'worker') return { ok: false, msg: 'This lookdev world takes no mods.' };
    const r = await this.sim.mod(pack);
    if (r.ok) {
      if (!this.packs.some((p) => p.id === pack.id)) this.packs.push(pack);
      void this.loadPowers();
      this.sim.requestFull();
    }
    return r;
  }

  /**
   * The opening's camera: 'star' — the young star from close, in the dark (the system camera at ~8 star radii, the orbit
   * lines hidden); 'world' — the fall to the home world, its lit side turning toward the eye in the afternoon light;
   * 'turn' — the world keeps turning under the camera for a few breaths (any touch of the camera stops it); 'done'.
   */
  private openingCamera(shot: 'star' | 'world' | 'turn' | 'done'): void {
    const view = this.sim.view;
    const home = view.planets.find((p) => p.params.orbit.parent < 0) ?? view.planets[0];
    if (!home) return;
    if (shot === 'star') {
      const sys = this.rig.system;
      sys.center = [0, 0, 0];
      sys.dist = Math.max(4e4, (view.star.radius || 11000) * 8.5);
      sys.pitch = 0.12;
      // the home world off to one side behind the star's glare
      sys.yaw = Math.atan2(home.center[0], home.center[2]) + 0.85;
      sys.fov = 42;
      this.rig.use(sys, 0);
      this.renderer.cut();
      if (this.orbitsShown === null) { this.orbitsShown = this.renderer.showOrbits; this.renderer.showOrbits = false; }
    } else if (shot === 'world') {
      // the camera's meridian a little east of noon: the lit face, the terminator at one edge, relief in raking light
      // (held there against the world's turning until the fall ends: a slow machine takes longer to fall)
      this.sunLock = home.id;
      this.rig.orbit.setFromLatLon(home.id, 16, this.afternoonLon(home), home.params.radius * 2.7, 0, null);
      this.rig.use(this.rig.orbit, 6.4);
    } else if (shot === 'turn') {
      this.sunLock = -1;
      this.turnT = 9;
      if (this.orbitsShown !== null) { this.renderer.showOrbits = this.orbitsShown; this.orbitsShown = null; }
    } else {
      this.turnT = 0;
      this.sunLock = -1;
      this.fx.ev = 0; this.fx.bloom = 1;
      if (this.orbitsShown !== null) { this.renderer.showOrbits = this.orbitsShown; this.orbitsShown = null; }
    }
  }

  /** the opening holds its view of the home world in the afternoon light while it falls (-1: no) */
  private sunLock = -1;

  /** the longitude (deg) a little east of the subsolar point: afternoon, the terminator in view */
  private afternoonLon(pv: PlanetView): number {
    const sunB = qRotateInv(pv.quat, pv.sunDir);
    return (Math.atan2(sunB[0], sunB[2]) * 180) / Math.PI + 52;
  }

  /** the live power catalogue (base + mods + inventions) from the sim */
  private async loadPowers(): Promise<void> {
    this.powersAt = performance.now();
    if (this.sim.source !== 'worker') return;
    const [d, cmds] = await Promise.all([this.sim.query('powers').catch(() => null), this.sim.query('commands').catch(() => null)]);
    this.powers.setFromSim(d);
    this.powers.setCommands(cmds);
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.resize(w, h, window.devicePixelRatio || 1);
    this.input.viewH = h;
  }

  /** the graphics preset and the settings' toggles on top of it (quality never changes the sim: CONTRACT §15.9) */
  private applyGraphics(): void {
    if (!this.renderer) return;
    const P = this.prefs.value;
    const name: QualityName = this.opts.quality !== 'auto' ? this.opts.quality : P.quality === 'auto' ? this.autoQuality : P.quality;
    if (name !== this.quality || this.renderer.quality.name !== name) { this.quality = name; this.renderer.setQuality(name); }
    const base = QUALITY[name];
    const g = P.gfx;
    const q = { ...base };
    q.renderScale = base.renderScale * g.renderScale;
    if (!g.shadows) q.shadowCascades = 0;
    if (!g.ssao) q.ssao = false;
    q.godRays = base.godRays && g.godRays;
    q.vegetationDensity = base.vegetationDensity * g.vegetation;
    q.vegetationRange = base.vegetationRange * Math.sqrt(g.vegetation);
    q.grass = base.grass && g.grass;
    this.renderer.quality = q;
    const s = this.renderer.settings;
    s.bloom = base.bloom * g.bloom;
    s.godRays = q.godRays;
    s.flare = g.flare ? base.flare : 0;
    s.fxaa = base.fxaa && g.fxaa;
    s.grain = g.grain ? base.grain : 0;
    s.vignette = g.vignette ? 0.22 : 0;
    s.exposureBias = this.opts.exposure + g.exposure;
    this.look = { exposure: s.exposureBias, bloom: s.bloom, vignette: s.vignette, grain: s.grain };
    if (this.orbitsShown === null) this.renderer.showOrbits = g.orbits; else this.orbitsShown = g.orbits;
    this.resize();
    this.applyLook();
  }

  /** the settings' look, with the opening's light and photo mode's lens on top (every frame: plain assignments) */
  private applyLook(): void {
    const s = this.renderer.settings;
    const L = this.lensState;
    const ph = this.camMode === 'photo';
    s.exposureBias = this.look.exposure + this.fx.ev + (ph ? L.exposure : 0);
    s.bloom = this.look.bloom * this.fx.bloom * (ph ? L.bloom : 1);
    s.vignette = ph ? L.vignette : this.look.vignette;
    s.grain = ph ? L.grain : this.look.grain;
  }

  // ── audio (src/audio/**, the audio lane's module; wired only through its published API) ──

  private async startAudio(): Promise<void> {
    const load = AUDIO_MODULE['./audio/engine.ts'];
    if (!load) return;
    try {
      const mod = await load();
      const a = this.prefs.value.audio;
      this.audio = mod.createAudio({ volumes: { master: a.master, music: a.music, sfx: a.sfx, ambience: a.ambience }, muted: a.muted, quality: this.quality === 'low' ? 'low' : 'high' });
      for (const c of this.audio.cues()) this.audioCues.add(c);
      // the portal's Mute button and the game's are one switch: mirror a portal mute into the Settings toggle
      this.audio.onMuteChange((m) => { if (this.prefs.value.audio.muted !== m) this.prefs.set('audio.muted', m); });
      setPanelSound((cue) => this.sound(cue));
      void this.audio.start();
    } catch (e) {
      console.warn('[genesis] audio unavailable:', e instanceof Error ? e.message : e);
      this.audio = null;
    }
  }

  private applyAudio(): void {
    const a = this.prefs.value.audio;
    if (!this.audio) return;
    this.audio.setVolumes({ master: a.master, music: a.music, sfx: a.sfx, ambience: a.ambience });
    this.audio.mute(a.muted);
  }

  sound(cue: string): void {
    if (this.audio && this.audioCues.has(cue)) { try { this.audio.cue(cue); } catch { /* a cue that fails is silence */ } }
  }

  /** one frame: input → clock → camera → render → snapshot request → UI */
  frame(now: number): void {
    const raw = Math.max(0, (now - this.last) / 1000);
    const dt = Math.min(0.1, raw);
    this.last = now;
    // the frame rate shown is the true one (dt is clamped for the camera and the clock, the rate is not)
    if (raw > 0) { this.frameSec = raw; this.fps = this.fps * 0.85 + (1 / raw) * 0.15; if (1 / raw < this.fps * 0.5) this.fps = 1 / raw; }
    try {
      const view = this.sim.view;
      view.update(now);
      this.ui.preFrame(dt);
      if (this.following) this.updateFollow(dt);
      this.cameraModesFrame(dt);
      const pose = this.rig.update(dt, view, this.input);
      // photo mode's roll: about the view axis, after the camera has placed itself
      if (this.camMode === 'photo' && this.lensState.roll) {
        const a = (this.lensState.roll * Math.PI) / 360;
        const r = qMul(pose.quat as [number, number, number, number], [0, 0, Math.sin(a), Math.cos(a)]);
        pose.quat[0] = r[0]; pose.quat[1] = r[1]; pose.quat[2] = r[2]; pose.quat[3] = r[3];
      }
      this.applyLook();
      if (this.rig.cut) { this.renderer.cut(); this.rig.cut = false; }
      this.updateHover();
      // the god hand follows the ground under the cursor and takes the UI hand's pose (render/hand.ts)
      this.renderer.godfx.setInput(this.hover, this.ui.hand.cursor, this.ui.hand.isAiming);
      this.renderer.render(view, pose, dt, (now - this.startAt) / 1000);
      if (this.captureWaiters.length) {
        const url = this.renderer.snapshotDataURL();
        for (const w of this.captureWaiters.splice(0)) w(url);
      }
      this.sim.pump(now);
      this.sendFocus(now);
      if (this.audio) {
        // before the toasts drain the events: the audio hears them first (it does not consume them)
        try { this.audio.setListener(pose, this.renderer.primaryId, this.renderer.stats.altitude); this.audio.update(view, dt); } catch (e) { console.warn('[genesis] audio frame failed', e); this.audio = null; }
      }
      this.ui.postFrame(dt);
      this.pruneUndone();
      this.updateMarker();
      this.updateHoverRing();
      if (now - this.powersAt > 60000) void this.loadPowers();
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

  private hudFrame() {
    const life = this.renderer.planets.get(this.renderer.primaryId)?.life;
    const view = this.sim.view;
    const pose = this.rig.pose;
    return {
      view, pose, stats: this.renderer.stats, fps: this.fps, primary: this.renderer.primaryId,
      systemView: this.rig.mode === 'system' || this.renderer.stats.altitude > 3e5,
      project: (s: ArrayLike<number>, out: Vector2) => this.renderer.projectToScreen(s, pose, out), source: this.sim.source, snapshotHz: this.sim.snapshotHz,
      altitude: this.renderer.stats.altitude, selected: this.sel as { kind: string; id: number; planet?: number } | null,
      groundRadius: (planet: number, u: ArrayLike<number>) => { const p = view.planet(planet); return p ? view.groundRadius(p, u[0], u[1], u[2]) : 0; },
      life: life && this.opts.dev ? {
        people: life.crowds.stats.agents, ambient: life.crowds.stats.ambient, animals: life.animals.stats.drawn,
        buildings: life.buildings.stats.instances, variants: life.buildings.stats.variants, pending: life.buildings.stats.pendingVariants,
        roads: life.roads.stats.chains,
      } : null,
    };
  }

  // ── input: everything goes to the UI shell ──

  private installInput(): void {
    const c = this.canvas;
    let lastX = 0, lastY = 0;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    const down = (e: PointerEvent, label: { planet: number; id: number } | null) => {
      // (a pointer the browser no longer tracks, or a synthetic one, cannot be captured: the press still counts)
      try { c.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      lastX = e.clientX; lastY = e.clientY;
      c.focus();
      if (e.button === 1) e.preventDefault();
      this.ui.pointerDown(e.clientX, e.clientY, e.button, e, e.timeStamp, label);
    };
    c.addEventListener('pointerdown', (e) => down(e, null));
    // a settlement's name or a creature over the world does not swallow a press: it goes to the world's own pointer
    // handling (a drag still turns the world, a tool still works, the hand still grabs), and a plain click on a name
    // selects that settlement
    this.ui.hud.world.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement | null;
      const nm = t?.closest<HTMLElement>('.gn-slabel-name');
      const cr = t?.closest<HTMLElement>('.gn-crea');
      if (!nm && !cr) return;
      e.preventDefault();
      e.stopPropagation();
      if (nm) down(e, { planet: Number(nm.dataset.planet), id: Number(nm.dataset.sid) });
      else if (cr) {
        // the creature under the hand: a click selects it, a drag or a hold takes it
        const id = Number(cr.dataset.cid), planet = Number(cr.dataset.planet);
        this.forcedEntity = { kind: 'creature', id, planet };
        down(e, null);
      }
    });
    c.addEventListener('pointermove', (e) => {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      // every sample since the last event, with its own time (a flick's speed and a rub's rhythm survive a slow frame)
      const co = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const pts = co.length > 1 ? co.map((q) => ({ x: q.clientX, y: q.clientY, t: q.timeStamp })) : null;
      this.ui.pointerMove(e.clientX, e.clientY, dx, dy, e.buttons, e.timeStamp, pts);
    });
    c.addEventListener('pointerup', (e) => { this.ui.pointerUp(e.clientX, e.clientY, e.button, e.timeStamp); this.forcedEntity = null; });
    c.addEventListener('pointercancel', () => this.ui.blur());
    c.addEventListener('pointerleave', (e) => { if (!e.buttons) { this.ui.pointerLeave(); this.hover = null; } });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      this.ui.wheel(e.deltaY * scale, e);
    }, { passive: false });
    // middle-click autoscroll must not start over the world
    c.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    window.addEventListener('keydown', (e) => this.ui.keyDown(e));
    window.addEventListener('keyup', (e) => this.ui.keyUp(e));
    window.addEventListener('blur', () => this.ui.blur());
  }

  /** the ground under the UI's cursor (mouse or gamepad), refreshed when it moved or the world turned */
  private updateHover(): void {
    const c = this.ui.cursor();
    if (!c) { this.hover = null; return; }
    if (this.frames % 2 === 1 && c[0] === this.hoverAt[0] && c[1] === this.hoverAt[1]) return;
    this.hoverAt = [c[0], c[1]];
    this.hover = this.pickGround(c[0], c[1]);
  }

  private pickGround(x: number, y: number): PickHit | null {
    const ndcX = (x / window.innerWidth) * 2 - 1;
    const ndcY = 1 - (y / window.innerHeight) * 2;
    const dir = rayDirection(this.renderer.camera, ndcX, ndcY, [0, 0, 0]);
    return pick(this.sim.view, this.rig.pose, dir);
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

  /** a creature, disaster or ship drawn near a screen point (by its projected position, within ~30 px) */
  private pickNear(x: number, y: number): EntityRef | null {
    const v = this.sim.view;
    let best: EntityRef | null = null, bd = 30;
    const consider = (planet: number, u: ArrayLike<number>, lift: number, ref: EntityRef, grace = 0) => {
      const s = this.screenOf(planet, u, lift);
      if (!s) return;
      const d = Math.hypot(s[0] - x, s[1] - y) - grace;
      if (d < bd) { bd = d; best = ref; }
    };
    for (const c of v.creatures) consider(c.planet, c.pos, c.height * 0.6, { kind: 'creature', id: c.id, planet: c.planet }, 6);
    for (const pv of v.planets) {
      if (pv.id !== this.renderer.primaryId) continue;
      for (const d of pv.disasters) consider(pv.id, d.pos, Math.max(4, d.params.alt ?? 0), { kind: 'disaster', id: d.id, planet: pv.id });
    }
    for (const s of v.ships) if (s.planet >= 0 && s.planet === this.renderer.primaryId) consider(s.planet, s.pos, s.alt, { kind: 'ship', id: s.id, planet: s.planet });
    return best;
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
    if (this.forcedEntity) { this.select(this.forcedEntity); return; }
    const near = this.pickNear(x, y);
    const ent = this.pickEntity(x, y);
    if (near && (!ent || near.kind === 'creature')) { this.select(near); return; }
    if (ent) { this.select({ kind: ent.kind, id: ent.id, planet: ent.planet }); return; }
    const hit = this.pickGround(x, y);
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
    // clicking a settlement's ground selects the settlement; elsewhere it recentres the orbit and lets go of the
    // selection (the cell itself is inspected with I, or by the inspector's place link)
    const pv = this.sim.view.planet(hit.planet);
    const st = pv ? this.settlementAt(pv.id, hit.dir) : null;
    if (st !== null) { this.select({ kind: 'settlement', id: st, planet: hit.planet }); return; }
    if (this.sel) this.select(null);
    if (this.rig.mode === 'orbit') {
      const o = this.rig.orbit;
      o.focus = [hit.dir[0], hit.dir[1], hit.dir[2]];
    }
  }

  /** the settlement whose territory (or, for a band, whose camp) covers a point, or null */
  settlementAt(planet: number, dir: ArrayLike<number>): number | null {
    const pv = this.sim.view.planet(planet);
    if (!pv) return null;
    const terr = pv.fields.get('territory');
    if (terr) {
      const c = pv.grid.nearestCell(dir[0], dir[1], dir[2]);
      const id = Math.round(terr[c]);
      if (id >= 0 && pv.settlements.some((s) => s.id === id && !(s.flags & 2))) return id;
    }
    const R = pv.params.radius;
    for (const s of pv.settlements) {
      if (s.flags & 2) continue;
      const d = Math.acos(Math.min(1, s.pos[0] * dir[0] + s.pos[1] * dir[1] + s.pos[2] * dir[2])) * R;
      if (d < 35) return s.id;
    }
    return null;
  }

  // ── UiHost ──

  async cmd(c: Command, opts: { quiet?: boolean } = {}): Promise<CommandResult> {
    // (the lookdev world fabricates what the render lane develops against — ships and world events, the god layer's
    // hand, creatures, disasters and weather: those reach its backend, which answers the rest in words)
    if (this.sim.source !== 'worker' && c.k !== 'focus' && !c.k.startsWith('hand.move') && !/^(lookdev\.|ship\.|world\.(crack|erase|moon-fall|birth))/.test(c.k)) {
      const r = { ok: false, msg: 'This is the lookdev world: nothing here listens. Run the living simulation (source=worker) to be obeyed.' };
      if (!opts.quiet) this.toast({ text: r.msg, kind: 'warn' });
      return r;
    }
    const r = await this.sim.cmd(c);
    if (c.k !== 'focus') this.freshAfter = performance.now();
    const ctl = r.control;
    if (ctl) {
      if (ctl.rewind !== undefined || ctl.edit !== undefined) this.sim.requestFull();
      if (ctl.save || ctl.load) void this.ui.saves.control(ctl);
      if (typeof ctl.speed === 'number') this.sim.view.speedChanged(ctl.speed);
    }
    if (!opts.quiet && c.k !== 'focus' && !c.k.startsWith('hand.move')) {
      const quietOk = c.k.startsWith('time.') && c.k !== 'time.rewind' && c.k !== 'time.edit-past';
      if (r.msg && r.msg !== 'queued for the next tick' && !(r.ok && quietOk)) {
        const planet = typeof c.planet === 'number' ? c.planet : this.primary();
        this.toast({ text: this.wordsFor(c, r.msg), ms: r.ok ? 5200 : 6500, kind: r.ok ? 'god' : 'warn', planet, action: r.ok ? this.undoAction(r, this.powers.powerOf(c)?.name, c.k) : null });
      }
      this.sound(r.ok ? 'ui.confirm' : 'ui.error');
    }
    return r;
  }

  /** a result line for people: places for coordinates, hours for minutes, names for "the agent" */
  private wordsFor(c: Command, msg: string): string {
    const planet = typeof c.planet === 'number' ? c.planet : this.primary();
    const t = c.target as { kind?: string; id?: number } | undefined;
    const held = this.sim.view.hand?.held ?? null;
    const ref = t && typeof t.id === 'number' ? { kind: String(t.kind ?? 'agent'), id: t.id, planet } : c.k.startsWith('hand.') && held ? { ...held, planet } : null;
    // the grab says the name ("You lift Shudak into the air."): kept for the throw that follows
    if (c.k === 'hand.grab') { const m = /^You (?:lift|pick up) (.+?)(?: into the air| off its foundations)?\.$/.exec(msg); this.lastHeldName = m && !/^(a|an|the) /.test(m[1]) ? m[1] : ref ? this.ui.catalog.nameOf(ref) : null; }
    const name = ref ? this.ui.catalog.nameOf(ref) ?? this.lastHeldName : c.k.startsWith('hand.') ? this.lastHeldName : null;
    return humanize(this.sim.view, planet, msg, { name, dayHours: this.sim.view.planet(planet)?.params.dayHours });
  }
  private lastHeldName: string | null = null;
  /** after an undo, for this many frames: a selected disaster / weather the rewind took away is let go */
  private pruneFrames = 0;

  private pruneUndone(): void {
    if (this.pruneFrames <= 0) return;
    this.pruneFrames--;
    const sel = this.sel;
    if (!sel || (sel.kind !== 'disaster' && sel.kind !== 'weather')) { this.pruneFrames = 0; return; }
    const pv = this.sim.view.planet(sel.planet ?? -1);
    const gone = !pv || (sel.kind === 'disaster' ? !pv.disasters.some((d) => d.id === sel.id) : !pv.weather.some((w) => w.id === sel.id));
    if (gone) { this.select(null); this.pruneFrames = 0; }
  }

  /**
   * "Undo" on a toast for an act that killed or ruined many — or that will (a disaster, a smiting miracle, a razing:
   * their dead come after the cast) — back to the minute before it (the world's rewind)
   */
  undoAction(r: CommandResult, what?: string, k?: string): ToastAction | null {
    if (!r.ok || typeof r.tick !== 'number' || this.sim.source !== 'worker') return null;
    const toll = tollOf(r.msg ?? '');
    const harmful = !!k && DESTRUCTIVE.test(k);
    if (toll.dead < 3 && toll.ruined < 2 && !harmful) return null;
    const tick = Math.max(0, r.tick - 1);
    return {
      label: 'Undo', title: 'Rewind the world to the minute before it',
      run: () => {
        void this.cmd({ k: 'time.rewind', tick, planet: this.primary() }, { quiet: true }).then((u) => {
          // the news of the undone minutes is taken back; a card on the undone thing closes once the world has turned back
          if (u.ok) { this.ui.hud.toasts.forget(tick); this.pruneFrames = 240; }
          this.toast({ text: u.ok ? `Undone: the world is back to the minute before ${what ? `the ${what.toLowerCase()}` : 'it'}.` : u.msg ?? 'That moment cannot be returned to.', kind: u.ok ? 'god' : 'warn' });
        });
      },
    };
  }

  parse(text: string): Promise<CommandResult> { return this.sim.parse(text); }

  query(q: string, args?: Record<string, unknown>): Promise<unknown> {
    // the lookdev world is fabricated: nobody in it has a story to ask for
    return this.sim.source === 'lookdev' ? Promise.resolve({ lookdev: true }) : this.sim.query(q, args ?? {});
  }

  primary(): number { return this.renderer.primaryId >= 0 ? this.renderer.primaryId : this.sim.view.planets[0]?.id ?? 0; }

  cursorGround(): GroundHit | null {
    const h = this.hover;
    return h ? { planet: h.planet, dir: [h.dir[0], h.dir[1], h.dir[2]] as UnitVec, cell: h.cell } : null;
  }

  focusGround(): GroundHit | null {
    const pv = this.sim.view.planet(this.primary());
    if (!pv) return null;
    let d: [number, number, number];
    if (this.rig.mode === 'orbit' && this.rig.orbit.planet === pv.id) d = [...this.rig.orbit.focus] as [number, number, number];
    else {
      const p = this.rig.pose.pos;
      d = qRotateInv(pv.quat, [p[0] - pv.center[0], p[1] - pv.center[1], p[2] - pv.center[2]]);
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      d = [d[0] / l, d[1] / l, d[2] / l];
    }
    return { planet: pv.id, dir: d, cell: pv.grid.nearestCell(d[0], d[1], d[2]) };
  }

  screenOf(planet: number, dir: ArrayLike<number>, lift = 0): [number, number] | null {
    const pv = this.sim.view.planet(planet);
    if (!pv || this.rig.mode === 'system') return null;
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const r = this.sim.view.groundRadius(pv, dir[0] / l, dir[1] / l, dir[2] / l) + lift;
    const b: [number, number, number] = [(dir[0] / l) * r, (dir[1] / l) * r, (dir[2] / l) * r];
    // behind the planet from here: hidden
    const cam = this.rig.pose.pos;
    const cb = qRotateInv(pv.quat, [cam[0] - pv.center[0], cam[1] - pv.center[1], cam[2] - pv.center[2]]);
    const toCam = [cb[0] - b[0], cb[1] - b[1], cb[2] - b[2]];
    if ((toCam[0] * b[0] + toCam[1] * b[1] + toCam[2] * b[2]) / r < -0.2 * Math.hypot(toCam[0], toCam[1], toCam[2])) return null;
    const s = qRotate(pv.quat, b);
    const p = this.renderer.projectToScreen([pv.center[0] + s[0], pv.center[1] + s[1], pv.center[2] + s[2]], this.rig.pose, this.v2);
    return p ? [p.x, p.y] : null;
  }

  groundAt(x: number, y: number): GroundHit | null {
    const h = this.pickGround(x, y);
    return h ? { planet: h.planet, dir: [h.dir[0], h.dir[1], h.dir[2]] as UnitVec, cell: h.cell } : null;
  }

  /** a press that began on a creature's silhouette: the hand takes that creature */
  private forcedEntity: EntityRef | null = null;

  entityAt(x: number, y: number): EntityRef | null {
    if (this.forcedEntity) return this.forcedEntity;
    const near = this.pickNear(x, y);
    const e = this.pickEntity(x, y);
    if (near && (!e || near.kind === 'creature')) return near;
    return e ? { kind: e.kind, id: e.id, planet: e.planet } : near;
  }

  date(planet: number, tick: number): string {
    const pv = this.sim.view.planet(planet);
    if (!pv) return '';
    const c = this.sim.view.calendar(pv, tick);
    return `Y${c.year} · d${c.day}`;
  }

  toast(spec: ToastSpec): void { this.ui?.hud.toasts.show(spec); }

  action(id: string): void { this.ui.action(id); }

  selected(): InspectRef | null { return this.sel; }

  // ── selection, follow, look ──

  /** select a thing (opens the inspector and the marker), or null to let go */
  select(ref: InspectRef | null): void {
    this.sel = ref ? { ...ref, planet: ref.planet ?? this.renderer.primaryId } as InspectRef : null;
    if (this.following && (!ref || this.following.kind !== ref.kind || this.following.id !== ref.id)) this.following = null;
    this.ui.selected(this.sel);
    this.selName = '';
    if (ref) this.sound('ui.open');
  }

  /** keep the camera on a thing (null stops); an orbit camera is used, at its current distance */
  follow(ref: EntityRef | null): void {
    if (ref) { this.leaveModes(null); this.rig.orbit.tiltFixed = this.rig.orbit.tiltFixed ?? 58; }
    this.following = ref ? { kind: ref.kind, id: ref.id, planet: ref.planet ?? this.renderer.primaryId } : null;
    if (!ref) return;
    this.sound('cam.follow');
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

  isFollowing(ref: EntityRef): boolean {
    return !!this.following && this.following.kind === ref.kind && this.following.id === ref.id;
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

  // ── camera modes: follow, cinematic (dolly), walk, photo ──

  camModeName(): CameraModeName {
    if (this.camMode) return this.camMode;
    if (this.following) return 'follow';
    const m = this.rig.mode;
    return m === 'system' ? 'system' : m === 'fly' || m === 'surface' ? 'fly' : 'orbit';
  }

  /** per frame, before the rig: the cinematic's arc, the opening's turning world, photo mode's lens on the wheel */
  private cameraModesFrame(dt: number): void {
    const input = this.input;
    if (this.camMode === 'dolly' && !this.modeApi.dolly) {
      const pv = this.sim.view.planet(this.dollyDrv.planet);
      if (!this.dollyDrv.update(dt, this.rig.orbit, input, pv?.params.radius ?? 3000)) this.dolly(null);
    }
    if (this.sunLock >= 0) {
      const pv = this.sim.view.planet(this.sunLock);
      if (pv && this.rig.mode === 'orbit' && this.rig.orbit.planet === pv.id) {
        const lon = (this.afternoonLon(pv) * Math.PI) / 180, lat = (16 * Math.PI) / 180;
        this.rig.orbit.focus = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      } else this.sunLock = -1;
    }
    if (this.turnT > 0) {
      const touched = !!(input.dragL[0] || input.dragL[1] || input.dragR[0] || input.dragR[1] || input.wheel || input.keys.size);
      if (touched || this.rig.mode !== 'orbit') this.turnT = 0;
      else {
        // the world turns under the eye (east to west, the way it spins), easing to a stop
        this.turnT = Math.max(0, this.turnT - dt);
        const w = 0.05 * Math.min(1, this.turnT / 9) ** 1.5;
        const f = this.rig.orbit.focus;
        const c = Math.cos(w * dt), sn = Math.sin(w * dt);
        const x = f[0] * c + f[2] * sn, z = -f[0] * sn + f[2] * c;
        f[0] = x; f[2] = z;
      }
    }
    if (this.camMode === 'photo') {
      // the wheel is the lens; a right drag looks like a left one
      if (input.wheel) { this.setLens({ fov: this.lensState.fov * Math.exp(input.wheel * 0.0011) }); input.wheel = 0; }
      input.dragL[0] += input.dragR[0]; input.dragL[1] += input.dragR[1];
      input.dragR[0] = input.dragR[1] = 0;
      this.rig.fly.fov = this.lensState.fov;
    }
  }

  /** where a thing stands, and the reach of a place (a settlement: its farthest building) */
  private placeOf(ref: InspectRef): { planet: number; dir: [number, number, number]; reach: number } | null {
    if (ref.kind === 'species' || ref.kind === 'planet') return null;
    const pv = this.sim.view.planet(ref.planet ?? this.renderer.primaryId);
    const b = pv ? this.entityBodyPos(pv, ref) : null;
    if (!pv || !b) return null;
    const l = Math.hypot(b[0], b[1], b[2]) || 1;
    const dir: [number, number, number] = [b[0] / l, b[1] / l, b[2] / l];
    let reach = ref.kind === 'building' ? 30 : ref.kind === 'creature' ? 25 : 18;
    if (ref.kind === 'settlement') {
      const B = pv.buildings;
      let r = 0;
      if (B) for (let i = 0; i < B.count; i++) {
        if (B.settlement[i] !== ref.id) continue;
        const d = B.pos[i * 3] * dir[0] + B.pos[i * 3 + 1] * dir[1] + B.pos[i * 3 + 2] * dir[2];
        r = Math.max(r, Math.acos(Math.max(-1, Math.min(1, d))) * pv.params.radius);
      }
      reach = Math.max(40, Math.min(600, r + 20));
    }
    return { planet: pv.id, dir, reach };
  }

  /** leave the camera modes other than `keep` without moving the camera (a new mode takes over from the pose) */
  private leaveModes(keep: 'walk' | 'dolly' | 'photo' | null): void {
    if (this.camMode === 'photo' && keep !== 'photo') this.photo(false);
    if (this.camMode === 'dolly' && keep !== 'dolly') { this.dollyDrv.active = false; this.modeApi.dolly?.(null); this.camMode = null; if (this.cineUi !== null) { this.setUi(this.cineUi); this.cineUi = null; } }
    if (this.camMode === 'walk' && keep !== 'walk') { this.modeApi.walk?.(null); this.camMode = null; }
  }

  /** the cinematic: an arc around a place (null ends it: the orbit camera stays where the arc left it) */
  dolly(ref: EntityRef | null): void {
    if (!ref) {
      if (this.camMode !== 'dolly') return;
      this.camMode = null;
      this.camSubject = null;
      this.dollyDrv.active = false;
      this.modeApi.dolly?.(null);
      if (this.cineUi !== null) { this.setUi(this.cineUi); this.cineUi = null; }
      // the tilt is the zoom's again (blended, not snapped)
      this.rig.orbit.tiltFixed = null;
      this.rig.use(this.rig.orbit, 0.9);
      return;
    }
    const at = this.placeOf(ref);
    if (!at) return;
    this.leaveModes('dolly');
    this.following = null;
    this.camMode = 'dolly';
    this.camSubject = { ...ref, planet: at.planet };
    if (this.modeApi.dolly) this.modeApi.dolly({ planet: at.planet, center: at.dir, radius: at.reach });
    else { this.dollyDrv.begin(this.rig.orbit, at.planet, at.dir, at.reach); this.rig.use(this.rig.orbit, 2.6); }
    // the interface steps aside for the film (Esc or a drag brings it back)
    if (this.cineUi === null) { this.cineUi = this.uiVisible; this.setUi(false); }
    this.sound('cam.cinematic');
  }

  /** heading (rad from north toward east) of a direction at a point of a world */
  private headingAt(planet: number, at: ArrayLike<number>, toward: ArrayLike<number>): number {
    const east: [number, number, number] = [0, 0, 0], north: [number, number, number] = [0, 0, 0];
    tangentBasis(east, north, at);
    const d = [toward[0] - at[0], toward[1] - at[1], toward[2] - at[2]];
    void planet;
    return Math.atan2(d[0] * east[0] + d[1] * east[1] + d[2] * east[2], d[0] * north[0] + d[1] * north[1] + d[2] * north[2]);
  }

  /** the camera's own heading at a point (its view direction laid on the ground) */
  private cameraHeading(planet: number, at: ArrayLike<number>): number {
    const pv = this.sim.view.planet(planet);
    if (!pv) return 0;
    const fwd = qRotateInv(pv.quat, qRotate(this.rig.pose.quat, [0, 0, -1]));
    return this.headingAt(planet, at, [at[0] + fwd[0], at[1] + fwd[1], at[2] + fwd[2]]);
  }

  /** walk among them: at a thing (a place: at its edge looking in; a person: a few steps from them), or where the
   * cursor (or the camera) points; `leave` rises back to an orbit over the spot */
  walk(ref: EntityRef | null, leave = false): void {
    if (leave) {
      if (this.camMode !== 'walk') return;
      this.camMode = null;
      this.camSubject = null;
      this.modeApi.walk?.(null);
      const o = this.rig.orbit;
      o.planet = this.walkCam.planet;
      o.focus = [this.walkCam.dir[0], this.walkCam.dir[1], this.walkCam.dir[2]];
      o.dist = 140;
      o.heading = this.walkCam.yaw;
      o.tiltBias = 0;
      o.tiltFixed = null;
      this.rig.use(o, 1.8);
      this.sound('cam.rise');
      return;
    }
    let planet: number, dir: [number, number, number], face: ArrayLike<number> | null = null;
    if (ref) {
      const at = this.placeOf(ref);
      if (!at) return;
      planet = at.planet;
      const pv = this.sim.view.planet(planet)!;
      // a few steps back from the thing toward where the camera is, then turn to face it
      const back = ref.kind === 'settlement' ? Math.max(14, at.reach * 0.55) : ref.kind === 'building' ? 16 : 4;
      const cam = this.rig.pose.pos;
      const c = qRotateInv(pv.quat, [cam[0] - pv.center[0], cam[1] - pv.center[1], cam[2] - pv.center[2]]);
      const cl = Math.hypot(c[0], c[1], c[2]) || 1;
      const dot = (c[0] * at.dir[0] + c[1] * at.dir[1] + c[2] * at.dir[2]) / cl;
      let t: [number, number, number] = [c[0] / cl - at.dir[0] * dot, c[1] / cl - at.dir[1] * dot, c[2] / cl - at.dir[2] * dot];
      let tl = Math.hypot(t[0], t[1], t[2]);
      if (tl < 1e-6) { const east: [number, number, number] = [0, 0, 0], north: [number, number, number] = [0, 0, 0]; tangentBasis(east, north, at.dir); t = north; tl = 1; }
      const k = back / pv.params.radius / tl;
      dir = [at.dir[0] + t[0] * k, at.dir[1] + t[1] * k, at.dir[2] + t[2] * k];
      const dl = Math.hypot(dir[0], dir[1], dir[2]);
      dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
      face = at.dir;
    } else {
      const g = this.cursorGround() ?? this.focusGround();
      if (!g) return;
      planet = g.planet;
      dir = [g.dir[0], g.dir[1], g.dir[2]];
    }
    const yaw = face ? this.headingAt(planet, dir, face) : this.cameraHeading(planet, dir);
    this.leaveModes('walk');
    this.following = null;
    this.walkCam.place(planet, dir, yaw, -0.05);
    if (this.modeApi.walk) this.modeApi.walk({ planet, at: dir, heading: yaw });
    else this.rig.use(this.walkCam, 2.2);
    this.camMode = 'walk';
    this.camSubject = ref ? { ...ref, planet } : null;
    this.sound('cam.walk');
  }

  /** the fly camera from the pose on screen: its position, and a level orientation looking where the camera looks */
  private flyFromPose(): boolean {
    const pv = this.sim.view.planet(this.renderer.primaryId) ?? this.sim.view.planets[0];
    if (!pv) return false;
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
    f.fov = this.rig.pose.fov;
    return true;
  }

  /** photo mode: the free camera from the pose on screen, the interface and the portal bar away, time still */
  photo(on: boolean): void {
    if (on === (this.camMode === 'photo')) return;
    if (on) {
      const wasWalk = this.camMode === 'walk';
      const ui = this.cineUi ?? this.uiVisible;
      if (this.camMode === 'dolly') { this.dollyDrv.active = false; this.modeApi.dolly?.(null); this.camMode = null; this.cineUi = null; }
      if (!this.flyFromPose()) return;
      this.photoPrev = { ctrl: wasWalk ? this.walkCam : this.rig.active, ui, speed: this.sim.view.speed, walk: wasWalk };
      if (!this.lensInit) { this.lensInit = true; this.lensState.vignette = this.look.vignette; this.lensState.grain = this.look.grain; }
      this.lensState.fov = this.rig.fly.fov;
      this.rig.use(this.rig.fly, 0);
      this.camMode = 'photo';
      this.following = null;
      this.setUi(false);
      if (this.photoFrozen) this.sim.setSpeed(0);
      this.modeApi.photo?.(true);
      this.modeApi.lens?.(this.lensState);
      this.ui.photo.enter();
      this.sound('cam.photo');
      return;
    }
    const p = this.photoPrev;
    this.photoPrev = null;
    this.camMode = null;
    this.modeApi.photo?.(false);
    this.ui.photo.leave();
    if (p) {
      if (p.walk) { this.camMode = 'walk'; this.rig.use(this.walkCam, 0.7); }
      else this.rig.use(p.ctrl === this.rig.fly ? this.rig.orbit : p.ctrl, 0.7);
      this.setUi(p.ui);
      if (this.photoFrozen && this.sim.view.speed === 0) this.sim.setSpeed(p.speed);
    } else this.setUi(true);
    this.applyLook();
  }

  private setLens(p: Partial<PhotoLens>): void {
    const L = this.lensState;
    Object.assign(L, p);
    const c = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
    L.fov = c(L.fov, 6, 100); L.focus = c(L.focus, 0.5, 20000); L.blur = c(L.blur, 0, 1); L.exposure = c(L.exposure, -3, 3);
    L.bloom = c(L.bloom, 0, 3); L.vignette = c(L.vignette, 0, 0.8); L.grain = c(L.grain, 0, 0.15); L.roll = c(L.roll, -35, 35);
    if (this.camMode === 'photo') this.rig.fly.fov = L.fov;
    this.modeApi.lens?.(L);
  }

  private freeze(on: boolean): void {
    this.photoFrozen = on;
    if (this.camMode !== 'photo') return;
    if (on) this.sim.setSpeed(0);
    else if (this.sim.view.speed === 0) this.sim.setSpeed(this.photoPrev?.speed || 1);
  }

  /** the local solar hour at the camera (photo mode's sun) */
  private localHour(): number {
    const pv = this.sim.view.planet(this.renderer?.primaryId ?? 0) ?? this.sim.view.planets[0];
    if (!pv) return 12;
    const p = this.rig.pose.pos;
    const b = rotate([-pv.quat[0], -pv.quat[1], -pv.quat[2], pv.quat[3]], [p[0] - pv.center[0], p[1] - pv.center[1], p[2] - pv.center[2]]);
    const lon = (Math.atan2(b[0], b[2]) * 180) / Math.PI;
    const D = pv.params.dayHours;
    const h0 = this.sim.view.calendar(pv).hour;
    return (((h0 + (lon / 360) * D) % D) + D) % D;
  }

  /**
   * Body-frame position (m) of a thing on a planet: where the life layer drew it this frame when it did, else from
   * the snapshot (people, herds, buildings, settlements, creatures, disasters, weather, ships, a cell).
   */
  entityBodyPos(pv: PlanetView, ref: { kind: string; id: number }): [number, number, number] | null {
    const life = this.renderer.planets.get(pv.id)?.life;
    const drawn = ref.kind === 'agent' || ref.kind === 'animal' || ref.kind === 'building' ? life?.positionOf(ref.kind, ref.id) : null;
    if (drawn) return drawn;
    let u: ArrayLike<number> | null = null;
    let lift = 0;
    const v = this.sim.view;
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
    } else if (ref.kind === 'agent' || ref.kind === 'animal') {
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
    } else if (ref.kind === 'creature') {
      const c = v.creatures.find((q) => q.id === ref.id && q.planet === pv.id);
      if (c) { u = c.pos; lift = c.height * 0.6; }
    } else if (ref.kind === 'disaster') {
      const d = pv.disasters.find((q) => q.id === ref.id);
      if (d) { u = d.pos; lift = 8 + Math.min(400, d.params.alt ?? 0); }
    } else if (ref.kind === 'weather') {
      const w = pv.weather.find((q) => q.id === ref.id);
      if (w) { u = w.pos; lift = 260; }
    } else if (ref.kind === 'ship') {
      const s = v.ships.find((q) => q.id === ref.id && q.planet === pv.id);
      if (s) { u = s.pos; lift = 4 + s.alt; }
    } else if (ref.kind === 'cell') {
      const P = pv.grid.pos;
      if (ref.id >= 0 && ref.id < pv.grid.count) { u = [P[ref.id * 3], P[ref.id * 3 + 1], P[ref.id * 3 + 2]]; lift = 2; }
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
    this.leaveModes(null);
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
    if (ref.kind === 'planet') { this.flyTo(ref.id); return; }
    const pv = this.sim.view.planet(ref.planet ?? this.renderer.primaryId);
    const b = pv ? this.entityBodyPos(pv, ref) : null;
    if (!pv || !b) return;
    const d = ref.kind === 'settlement' ? 240 : ref.kind === 'building' ? 70 : ref.kind === 'disaster' || ref.kind === 'weather' ? 900 : ref.kind === 'creature' ? 60 : 28;
    this.lookAt(pv.id, b, d);
    this.frameBesideInspector(pv, d);
  }

  /**
   * With the inspector open on the right, the thing looked at belongs in the middle of what is left of the screen:
   * move the orbit's focus to the right (along the camera's own right at the end of the move) by half the card's
   * width in metres at that distance, so the thing sits left of centre, in the open.
   */
  private frameBesideInspector(pv: PlanetView, dist: number): void {
    const insp = this.ui.inspector;
    if (!insp.isOpen) return;
    const r = insp.root.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    if (r.width < 40 || r.left > W) return;
    const shiftPx = (W - r.left + 18) / 2;
    const o = this.rig.orbit;
    const f = o.focus;
    // the camera's right at the focus, as the orbit camera builds it (east · cos h − north · sin h)
    const fl = Math.hypot(f[0], f[1], f[2]) || 1;
    const up: [number, number, number] = [f[0] / fl, f[1] / fl, f[2] / fl];
    const east: [number, number, number] = [0, 0, 0], north: [number, number, number] = [0, 0, 0];
    tangentBasis(east, north, up);
    const hd = o.heading ?? 0;
    const right = [east[0] * Math.cos(hd) - north[0] * Math.sin(hd), east[1] * Math.cos(hd) - north[1] * Math.sin(hd), east[2] * Math.cos(hd) - north[2] * Math.sin(hd)];
    const fov = (this.rig.pose.fov * Math.PI) / 180;
    const metres = (shiftPx / (H / 2)) * Math.tan(fov / 2) * dist;
    const ang = metres / pv.params.radius;
    const nf = [up[0] + right[0] * ang, up[1] + right[1] * ang, up[2] + right[2] * ang];
    const nl = Math.hypot(nf[0], nf[1], nf[2]) || 1;
    o.focus = [nf[0] / nl, nf[1] / nl, nf[2] / nl];
  }

  /** the hand's hover: a ring over the person (or herd, building, creature) it would take */
  private updateHoverRing(): void {
    const el = this.hoverEl;
    if (!el) return;
    const ref = this.ui.hand.hoverRef;
    const pv = ref ? this.sim.view.planet(ref.planet ?? this.renderer.primaryId) : undefined;
    const b = ref && pv && this.rig.mode !== 'system' && !(this.sel && this.sel.kind === ref.kind && this.sel.id === ref.id) ? this.entityBodyPos(pv, ref) : null;
    if (!ref || !pv || !b) { el.hidden = true; return; }
    const s = qRotate(pv.quat, b);
    const p = this.renderer.projectToScreen([pv.center[0] + s[0], pv.center[1] + s[1], pv.center[2] + s[2]], this.rig.pose, this.v2);
    if (!p) { el.hidden = true; return; }
    el.hidden = false;
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
  }

  /** the marker over the selected thing: projected every frame; hidden when off screen or not placeable */
  private updateMarker(): void {
    const el = this.selEl;
    if (!el) return;
    const ref = this.sel;
    const pv = ref && ref.kind !== 'species' && ref.kind !== 'planet' ? this.sim.view.planet(ref.planet ?? -1) : undefined;
    const b = ref && pv && this.rig.mode !== 'system' ? this.entityBodyPos(pv, ref) : null;
    if (!ref || !pv || !b) { el.hidden = true; return; }
    const s = qRotate(pv.quat, b);
    const p = this.renderer.projectToScreen([pv.center[0] + s[0], pv.center[1] + s[1], pv.center[2] + s[2]], this.rig.pose, this.v2);
    if (!p || p.x < -40 || p.y < -40 || p.x > window.innerWidth + 40 || p.y > window.innerHeight + 40) { el.hidden = true; return; }
    el.hidden = false;
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${(p.y - 6).toFixed(1)}px) translate(-50%, -100%)`;
    const nameEl = this.ui.inspector.root.querySelector('.gn-insp-name');
    const name = nameEl?.textContent && nameEl.textContent !== '…' ? nameEl.textContent : '';
    if (name !== this.selName) { this.selName = name; (el.firstElementChild as HTMLElement).textContent = name; }
  }

  /**
   * Tell the sim where the camera dwells (a logged `focus` command, so determinism holds): it is the default place for
   * commands given without one ("rain here") and, later, where cohorts are promoted to individuals. At most every
   * 2.5 s, and only when the point moved more than ~1° or the world changed. While the "do this" field is open its
   * "here" (the cursor point) is the focus instead.
   */
  private sendFocus(now: number): void {
    if (now - this.focusSentAt < 2500 || !this.sim.backend || this.ui.freeform.isOpen) return;
    const mode = this.rig.mode;
    if (mode === 'system') return;
    const g = this.focusGround();
    if (!g) return;
    const d = g.dir;
    const last = this.focusSent;
    if (last && this.focusPlanet === g.planet && last[0] * d[0] + last[1] * d[1] + last[2] * d[2] > Math.cos(0.0175)) return;
    this.focusSentAt = now;
    this.focusSent = [d[0], d[1], d[2]];
    this.focusPlanet = g.planet;
    void this.sim.cmd({ k: 'focus', planet: g.planet, pos: d });
  }

  // ── actions (HUD, keys, test surface) ──

  setSpeed(x: number): void { this.sim.setSpeed(Math.max(0, x)); }
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

  flyTo(planet: number): void {
    if (planet < 0) return;
    this.leaveModes(null);
    this.rig.flyToPlanet(this.sim.view, planet);
  }
  systemView(): void {
    this.leaveModes(null);
    this.rig.system.frame(this.sim.view);
    this.rig.use(this.rig.system, 2.6);
  }
  private toggleFly(): void {
    if (this.camMode === 'photo') return;
    if (this.camMode === 'walk' || this.rig.mode === 'fly' || this.rig.mode === 'surface') { this.leaveModes(null); this.rig.use(this.rig.orbit, 1.2); return; }
    this.leaveModes(null);
    // start flying from the current pose: position + level orientation looking where the camera looks
    if (this.flyFromPose()) this.rig.use(this.rig.fly, 0.4);
  }

  setUi(v: boolean): void {
    this.uiVisible = v;
    this.ui?.hud.setVisible(v);
    // clean frames (trailer stills, photo mode, __GENESIS__.ui(false)) hide the ForgeFlow portal bar too (styles.css)
    document.body.classList.toggle('genesis-clean', !v);
  }

  setQuality(name: QualityName): void {
    this.opts.quality = name;
    this.applyGraphics();
  }

  // ── saves (the worker's save / load) ──

  private async saveBytes(): Promise<ArrayBuffer | null> {
    if (this.sim.source !== 'worker') return null;
    return this.sim.save();
  }

  /**
   * Open a save in this simulation. The packs it needs go to the worker first — those this world already has, those the
   * slot or the file carried, those in the mod library; one found nowhere is named (refused in words). A save made
   * without a pack this world has that would change what it holds needs a fresh simulation (`reload`).
   */
  private async loadSave(bytes: ArrayBuffer, carried: ContentPack[]): Promise<LoadOutcome> {
    if (this.sim.source !== 'worker') return { ok: false, msg: 'the lookdev world cannot open a save' };
    let hdr;
    try { hdr = readSaveHeader(bytes); } catch (e) { return { ok: false, msg: e instanceof Error ? e.message : String(e) }; }
    const have = new Map(this.packs.map((p) => [p.id, p]));
    const missing: PackRef[] = [];
    for (const id of neededPacks(hdr)) {
      if (have.has(id)) continue;
      const pk = carried.find((p) => p.id === id) ?? (await this.library.get(id).catch(() => undefined))?.json;
      if (!pk) { missing.push(hdr.packs.find((p) => p.id === id) ?? { id, name: id, version: '' }); continue; }
      const r = await this.sim.mod(pk);
      if (!r.ok && !r.deferred) return { ok: false, msg: `the content pack '${pk.name ?? id}' it needs was refused: ${r.msg ?? ''}` };
      have.set(id, pk);
    }
    if (missing.length) return { ok: false, missing };
    const r = await this.sim.load(bytes);
    if (!r.ok) return { ok: false, msg: r.msg, reload: /made without the pack/i.test(r.msg ?? '') };
    // the world is the save's now
    this.packs = [...have.values()];
    this.world = { scenario: hdr.scenario.startsWith('custom') ? 'custom' : hdr.scenario, seed: hdr.seed };
    this.leaveModes(null);
    this.sim.requestFull();
    this.select(null);
    this.following = null;
    this.turnT = 0;
    void this.loadPowers();
    return { ok: true };
  }

  /** a small picture of the view for a save slot */
  private async thumb(): Promise<string | null> {
    const url = await Promise.race([this.capture(), new Promise<string>((ok) => setTimeout(() => ok(''), 8000))]);
    if (!url) return null;
    return new Promise((ok) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 256; c.height = Math.round(256 * img.height / Math.max(1, img.width));
        c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => ok(null);
      img.src = url;
    });
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
    // the render lane's modes take their whole spec when bound (render/camera/modes.ts applySpec: the lens, the dolly's
    // phase, the follow distance, the walking body's alignment)
    if ((mode === 'follow' || mode === 'dolly' || mode === 'walk' || mode === 'photo') && this.modeApi === this.rig.modes) { await this.renderModeSpec(spec, mode); return; }
    // a camera mode that takes a thing: follow it, circle it, walk beside it (CONTRACT §18 camera(spec))
    if ((mode === 'follow' || mode === 'dolly' || mode === 'walk') && isTargetRef(spec.target)) {
      const ref: EntityRef = { kind: spec.target.kind, id: spec.target.id, planet: spec.target.planet ?? spec.planet ?? this.primary() };
      for (let i = 0; i < 60; i++) { const pv = this.sim.view.planet(ref.planet!); if (pv && this.entityBodyPos(pv, ref)) break; await this.waitFrames(1); }
      if (mode === 'follow') this.follow(ref);
      else if (mode === 'dolly') this.dolly(ref);
      else this.walk(ref);
      if (spec.blend === 0) { this.rig.update(0, view, newInput()); this.renderer.cut(); }
      return;
    }
    // any other spec takes the camera out of its modes first
    if (this.camMode === 'photo' && mode !== 'photo') this.photo(false);
    if (this.camMode === 'dolly') this.dolly(null);
    if (this.camMode === 'walk' && mode !== 'walk') { this.modeApi.walk?.(null); this.camMode = null; }
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
    if (mode === 'walk') {
      // the walking body at a point (lat / lon / poi), looking along the heading
      const d2r = Math.PI / 180;
      const dir: [number, number, number] = [Math.cos(lat * d2r) * Math.sin(lon * d2r), Math.sin(lat * d2r), Math.cos(lat * d2r) * Math.cos(lon * d2r)];
      this.leaveModes('walk');
      this.walkCam.place(planet, dir, heading * d2r, ((spec.pitch ?? -3) * Math.PI) / 180);
      if (spec.fov) this.walkCam.fov = spec.fov;
      this.rig.use(this.walkCam, blend);
      this.camMode = 'walk';
      this.camSubject = null;
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
        else if (this.rig.active === this.walkCam) this.walkCam.yaw = yaw;
        this.renderer.cut();
      }
    }
    if (mode === 'photo' && this.camMode !== 'photo') { this.rig.update(0, this.sim.view, newInput()); this.photo(true); }
  }

  /** camera(spec) for the render lane's follow / dolly / walk / photo (the place from a POI, a target or lat / lon) */
  private async renderModeSpec(spec: CameraSpec, mode: 'follow' | 'dolly' | 'walk' | 'photo'): Promise<void> {
    const view = this.sim.view;
    let planet = spec.planet ?? (this.renderer.primaryId >= 0 ? this.renderer.primaryId : view.planets[0]?.id ?? 0);
    let lat = spec.lat ?? 20, lon = spec.lon ?? 0, heading = spec.yaw ?? 0;
    let ref: EntityRef | null = null;
    if (isTargetRef(spec.target)) {
      ref = { kind: spec.target.kind, id: spec.target.id, planet: spec.target.planet ?? planet };
      if (ref.kind === 'ship') {
        // a ship can be anywhere: its own world, or between the worlds
        for (let i = 0; i < 60 && !view.ships.some((s) => s.id === ref!.id); i++) await this.waitFrames(1);
        const sv = view.ships.find((s) => s.id === ref!.id);
        if (sv && sv.planet >= 0) { planet = sv.planet; ref.planet = sv.planet; }
      } else {
        const pv0 = view.planet(planet);
        let b = pv0 ? this.entityBodyPos(pv0, ref) : null;
        for (let i = 0; i < 60 && !b; i++) { await this.waitFrames(1); const pv1 = this.sim.view.planet(planet); b = pv1 ? this.entityBodyPos(pv1, ref) : null; }
        if (b) {
          const l = Math.hypot(b[0], b[1], b[2]);
          lat = (Math.asin(Math.max(-1, Math.min(1, b[1] / l))) * 180) / Math.PI;
          lon = (Math.atan2(b[0], b[2]) * 180) / Math.PI;
        }
      }
    }
    const pv = view.planet(planet);
    if (spec.poi && pv) {
      const poi = findPoi(pv, spec.poi);
      if (poi) { lat = poi.lat; lon = poi.lon; heading = poi.heading + (spec.turn ?? 0) + (spec.yaw ?? 0); }
    }
    const extra = spec as unknown as Record<string, unknown>;
    const num = (k: string): number | undefined => (typeof extra[k] === 'number' ? extra[k] as number : undefined);
    this.leaveModes(null);
    this.following = null;
    this.rig.modes.applySpec({
      mode, planet, lat, lon, yaw: heading, pitch: spec.pitch, alt: spec.alt, dist: spec.dist, fov: spec.fov, target: ref, blend: spec.blend,
      t: num('t'), radius: num('radius'), duration: num('duration'), focus: num('focus'), blur: num('blur'), exposure: num('exposure'), roll: num('roll'), alignment: num('alignment'),
    }, view);
    if (mode === 'photo') this.setUi(false);
    if ((spec.blend ?? 0) === 0) { this.rig.update(0, view, newInput()); this.renderer.cut(); }
    if (spec.hour != null) await this.setLocalHour(spec.hour, lon);
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
      scenario: this.world.scenario, seed: this.world.seed, source: this.sim.source, quality: this.quality, frames: this.frames,
      camera: { mode: this.camModeName(), rig: this.rig.mode, planet: pose.planet, pos: [...pose.pos], quat: [...pose.quat], fov: pose.fov, altitude: this.renderer.stats.altitude, walked: this.walkCam.walked },
      packs: this.packs.map((p) => p.id), content: [...this.sim.view.content],
      render: { ...this.renderer.stats },
      planets: v.planets.map((p) => ({
        id: p.id, name: p.name, kind: p.params.kind, radius: p.params.radius,
        pop: p.population.reduce((a, b) => a + b, 0), settlements: p.settlements.length,
        agents: p.agents?.count ?? 0, buildings: p.buildings?.count ?? 0,
        era: p.settlements[0]?.era ?? null, calendar: v.calendar(p),
      })),
      hover: this.hover,
      selected: this.sel, following: this.following,
      ui: this.ui?.state() ?? null,
      audio: this.audio ? (() => { try { const s = this.audio!.state(); return { running: s.running, voices: s.voices }; } catch { return null; } })() : null,
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
    this.audio?.dispose();
  }
}

function rotate(q: ArrayLike<number>, v: ArrayLike<number>): [number, number, number] {
  const x = v[0], y = v[1], z = v[2];
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}
