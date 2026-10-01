// DYEFIELD — the app shell. Boot: params → WebGL2 check → loading card → shared loads (Rapier, the tide-runner
// + every kit / sub / special model) → an ARENA (map geometry + paint atlas, map view, sky, water, physics, bot
// nav) → a SESSION on it (the roster, one merged runner body per kit, FX, HUD, a Game) → shader pre-warm.
//
// Phase 9 (CONTRACT_P6_11 §20): a bare URL opens the LOBBY — the menus (ui/menus.ts) over a live Pier 18 at
// noon (a 'lobby' Game: a few bots painting, a drifting camera). START on the map select asks for pointer lock
// (the click is the gesture), shows the loading card, swaps the session (and the arena when the map or the
// time of day differs; Pier 18 at noon is reused as is) and goes straight into the countdown when the lock
// is held (else CLICK TO PLAY). QUIT MATCH / LOBBY swap back. One page, one renderer, one arena resident at a
// time; a session's dispose() removes its listeners, DOM and GPU objects.
//
// Deep links (harnesses, CONTRACT §6 / §11) skip the lobby: any of ?map ?kit ?bots ?seed ?matchSeconds ?preset
// ?autostart ?brush loads that match directly → CLICK TO PLAY (or ?autostart=1 → play at once). ?lobby=1 forces
// the lobby. Query params: ?map=pier18|lockwell|cinder · ?dev=1 · ?preset=noon|golden|… · ?seed=N ·
//   ?kit=mist-rasp|sheet-drum|needle-glint|pop-well · ?bots=breeze|swell|storm · ?crew=sun|gulf ·
//   ?autostart=1 · ?quality=auto|high|low
// dev-only (?dev=1): ?matchSeconds=N · ?brush=1 (LMB = the phase-2 DEV_BRUSH) · ?merge=0 · ?tonemap=…
// Any failure lands on the error card with the message (never a blank canvas).
//
// Phase 10 (CONTRACT_P6_11 §21): ONE GameAudio per page (audio/README.md): created at boot with the saved volumes,
// unlocked by the first gesture (plus explicitly in the first menu click / the CLICK TO PLAY click), the lobby cue
// on every lobby entry, the menus' hover / click / back / start through MenuHooks.sound, the SETTINGS sliders live;
// the Game ticks it every frame (a match routes its events + the camera as the listener) and plays the victory /
// defeat stinger. One Juice per MATCH session (ui/juice.ts): the hit markers, the damage vignette + arc, the trauma
// shake and the victory confetti; REDUCE MOTION and COLORBLIND MARKS reach it (and the runner / FX dye) live.
//
// CONTRACT_FFA F3 (FREE-FOR-ALL): `?mode=ffa|teams` (default teams; a deep-link key) and the menus' MODE pick choose
// the match mode. An FFA session builds the FFA roster (the human on its colour — `?crew=1..8` or a colour key such
// as `?crew=violet`, else the LOADOUT pick, default amber — and bots on the other seven), runs MatchWorld in 'ffa',
// switches the dye shader (setDyeMode) and the minimap raster (setPalette) to the 8-crew palette, and gives the HUD
// its FFA mode. Teams sessions (and the lobby) take none of these branches.
//
// CONTRACT_MOBILE (M1 M2 M4 M7 M10; every branch keys off input.mode, so keyboard + mouse is unchanged): the Input is
// built BEFORE the renderer so the WebGL context knows the input method at creation (touch + DPR ≥ 2 → antialias off;
// ?aa=0|1 overrides for measurement) and the renderer's touch profile. A match session builds the TouchControls
// overlay (settings → options live, PAUSE → the ESC pause path, a minimap tap → the 'map' UI action) and hands it to
// the Game. Touch mode: START goes straight into the countdown (no pointer-lock request), the play card reads TAP TO
// PLAY (BootUI.setTouch), and the START / TAP TO PLAY gesture asks for fullscreen + a landscape orientation lock (all
// silent on failure). The rotate overlay (ui/boot.ts RotateOverlay) pauses a live match when it appears. A lost WebGL
// context pauses and shows "Graphics were reset by the device" with RELOAD; a restored one reloads. __DF__.touch() is
// the M10 read-back. Integration (M12): the UI lane's hud.setTouchMode / menus.setTouchMode / BootUI.setTouch /
// RotateOverlay are called directly on Input.onMode (a hybrid switch) and at session start.
//
// Mobile review fixes (2026-09-29): A-A2 START never begins the countdown under the rotate overlay (the play card waits);
// B-F1 a context lost mid-load keeps the reset card (every flow returns after its last await); A-A4 one fetch of the
// map GLB feeds both parsers; A-A9 a screen wake lock (touch) through the match session; A-A6 the START gesture pushes
// the back-button trap entry (game.ts owns the popstate pause).

/// <reference types="vite/client" />

import '@fontsource/lilita-one/400.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import './ui/styles.css';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mapById, teamById, hexToRgb01, WEAPONS, playableMaps, FFA_CREWS, type LightingPreset, type MapDef } from './core/data.ts';
import { parseMatchMode, parseMatchRule, type MatchMode, type MatchRule, type TeamId } from './core/types.ts';
import { extractMapGeometry, type MapGeometry } from './core/mapgeo.ts';
import { artUrl, parseGlb } from './core/glb.ts';
import { buildAtlas, type PaintAtlas } from './core/paint/atlas.ts';
import { Painter } from './core/paint/painter.ts';
import { MinimapRaster } from './core/paint/minimap.ts';
import { loadRapier, PhysicsWorld, type Rapier } from './core/physics.ts';
import { defaultRoster, ffaCrew, parseBotSkill, type BotSkill, type RosterEntry } from './core/match/roster.ts';
import { buildNav, type NavGraph } from './core/bots/nav.ts';
import { createRenderer, hasWebGL2, isRenderQuality, type RenderQuality, type RendererRig } from './view/renderer.ts';
import { FollowCamera } from './view/camera.ts';
import { createSky, type SkyRig } from './view/sky.ts';
import { createWater, type WaterRig } from './view/water.ts';
import { PaintTexture } from './view/paintlayer.ts';
import { createDyeUniforms, setDyeMode, setPadColorblind, type DyeUniforms } from './view/surfaces.ts';
import { loadMapView, addDropMarkers, type MapView, type DropMarkers } from './view/mapview.ts';
import { loadHeroAssets, type HeroAssets } from './view/heroview.ts';
import { PlayerViews, prepareRunnerKit, loadKitArt, mixedBotKits, kitFireType, type RunnerKit, type KitArt } from './view/players.ts';
import { Fx, bakeFxModels } from './view/fx.ts';
import { Hud, applyTeamCssVars, crewLook, type HudKit } from './ui/hud.ts';
import { createJuice, type Juice } from './ui/juice.ts';
import { createAudio, type GameAudio } from './audio/index.ts';
import { BootUI, RotateOverlay } from './ui/boot.ts';
import { Menus, crewColors, type StartSelection } from './ui/menus.ts';
import { SettingsStore, ProfileStore, type Settings } from './ui/settings.ts';
import { Mannequin } from './ui/mannequin.ts';
import { MAP_THUMBS } from './ui/icons.ts';
import { Input, type InputMode } from './input.ts';
import { TouchControls, type TouchOptions } from './touch/controls.ts';
import { Game, armBackTrap, type AppStatus, type GameHooks, type GameMode, type MatchConfig } from './game.ts';
import { installTestSurface, type AppHandles } from './testsurface.ts';

/** CONTRACT_MOBILE M8 settings → the overlay's options */
function touchOptions(s: Readonly<Settings>): TouchOptions {
  return { sens: s.touchSens, scale: s.touchScale, opacity: s.touchOpacity, leftHanded: s.touchLeftHanded, haptics: s.haptics };
}

/**
 * CONTRACT_MOBILE M4: on the TAP TO PLAY / START gesture (touch mode), full screen without the browser UI, then a
 * landscape orientation lock (Android Chrome only locks in full screen). Must run synchronously inside the gesture.
 * Every failure is silent: iPhone Safari has no element full screen (M9 covers it), desktops refuse the lock.
 */
function enterFullscreenLandscape(): void {
  const lock = (): void => {
    try {
      const o = (screen as Screen & { orientation?: ScreenOrientation & { lock?: (o: string) => Promise<void> } }).orientation;
      const p = o?.lock?.('landscape');
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch { /* unsupported */ }
  };
  try {
    const de = document.documentElement;
    if (document.fullscreenEnabled && !document.fullscreenElement && typeof de.requestFullscreen === 'function') {
      const p = de.requestFullscreen({ navigationUI: 'hide' });
      if (p && typeof p.then === 'function') p.then(lock, () => undefined);
      else lock();
    } else lock();
  } catch { /* unsupported */ }
}

/**
 * Review A-A9: keep the screen on while a touch match session loads and runs (Screen Wake Lock). The load after START
 * runs with no finger on the glass — 25–45 s on a throttled 4G phone, longer than a 30 s auto-lock (iOS Low Power Mode
 * forces 30 s). Feature-detected and silent on refusal; the browser drops the lock whenever the page is hidden, so it is
 * taken again on return. Touch only: keyboard + mouse never asks (desktop unchanged). Held for the whole match session
 * (pause and victory cards included); released on the way back to the lobby and when the graphics context is lost.
 */
let wake: WakeLockSentinel | null = null;
let wantWake = false;
let wakeRequests = 0;
function keepAwake(on: boolean): void {
  wantWake = on;
  if (!on) {
    const s = wake;
    wake = null;
    s?.release().catch(() => undefined);
    return;
  }
  if (wake || typeof navigator === 'undefined' || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeRequests++;
    navigator.wakeLock.request('screen').then((s) => {
      if (!wantWake || wake) { s.release().catch(() => undefined); return; }
      wake = s;
      s.addEventListener('release', () => { if (wake === s) wake = null; });
    }, () => undefined);
  } catch { /* unsupported / not allowed here */ }
}

/**
 * Review A-A4: the map GLB is fetched ONCE per arena and both parsers read the same bytes (the core's geometry
 * extraction and the view's GLTFLoader). The second request of the old path was not reliably an HTTP-cache hit: a
 * private tab's memory cache takes no entry over 6.25 MB and an Android WebView's 20 MB disk cache none over 5 MB, so
 * CINDER (7.3 MB) was downloaded twice, back to back, before TAP TO PLAY. Progress follows the decoded size: the CDN's
 * X-File-Size when it compresses the body (review A-A5), else Content-Length of an unencoded body.
 */
async function fetchMapBytes(def: MapDef, onProgress: (f: number) => void): Promise<ArrayBuffer> {
  const url = artUrl(`map_${def.id}.glb`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[glb] fetch ${url} failed: HTTP ${res.status}`);
  const xfs = Number(res.headers.get('x-file-size'));
  const encoded = !!res.headers.get('content-encoding');
  const total = xfs > 0 ? xfs : !encoded ? Number(res.headers.get('content-length')) : 0;
  const reader = res.body && total > 0 && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) {
    const buf = await res.arrayBuffer();
    onProgress(1);
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    got += value.byteLength;
    onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  onProgress(1);
  return out.buffer;
}

export const VERSION = 'dyefield-1.4.0';

declare global {
  interface Window {
    __DF_MAIN__?: boolean;
    __DF_BOOT__?: { handoff(): void; fail(title: string, detail: string): void };
  }
}

const params = new URLSearchParams(location.search);
// CONTRACT_WASHOUT W4: ?rule=washout|turf is a deep-link key too (index.html's static-card script mirrors this list)
const DEEP_KEYS = ['map', 'kit', 'bots', 'seed', 'matchSeconds', 'preset', 'autostart', 'brush', 'crew', 'mode', 'rule'];
/** a harness / share link straight into a match (no lobby) */
const DEEP_LINK = params.get('lobby') !== '1' && DEEP_KEYS.some((k) => params.has(k));
const LOBBY_MAP = 'pier18';
const LOBBY_PRESET = 'noon';

const app: AppStatus = {
  phase: 'boot',
  mapId: params.get('map') || LOBBY_MAP,
  dev: params.get('dev') === '1',
  version: VERSION,
  game: null,
  startedBy: null,
  lockErrors: 0,
  lockSuccesses: 0,
};

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const rgb255 = (hex: string): [number, number, number] => {
  const c = hexToRgb01(hex);
  return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
};
const randomSeed = (): number => (Math.random() * 0x7fffffff) >>> 0;

/** ?kit ?bots ?seed ?matchSeconds ?brush ?crew → the deep-link match settings */
function paramConfig(): MatchConfig {
  const kitQ = params.get('kit') || 'mist-rasp';
  let kit = kitQ;
  if (!WEAPONS.kits.some((k) => k.id === kitQ)) {
    console.info(`[dyefield] ?kit=${kitQ} is not a kit in weapons.json (${WEAPONS.kits.map((k) => k.id).join(', ')}) — using mist-rasp`);
    kit = 'mist-rasp';
  }
  const skill: BotSkill = parseBotSkill(params.get('bots'));     // breeze | swell | storm (the old chill | fresh | fierce still parse)
  const sq = params.get('seed');
  const seed = sq !== null && sq !== '' && Number.isFinite(Number(sq)) ? (Number(sq) >>> 0) : randomSeed();
  const cq = (params.get('crew') || '').toLowerCase();
  // CONTRACT_FFA F3: ?mode=ffa|teams (default teams); in FFA ?crew= is the human's colour (1..8 or a colour key)
  const mode: MatchMode = parseMatchMode(params.get('mode'));
  // CONTRACT_WASHOUT W4: ?rule=washout|turf (default turf)
  const rule = paramRule();
  const ruleOpt = rule === 'washout' ? { rule } : {};
  if (mode === 'ffa') {
    const byKey = FFA_CREWS.find((c) => c.key === cq);
    const crew = byKey ? byKey.id : ffaCrew(cq || 1);
    return { kit, skill, seed, durationS: devSeconds(), crew, mode, devBrush: app.dev && params.get('brush') === '1', ...ruleOpt };
  }
  const crew: TeamId = cq === '2' || cq === 'gulf' ? 2 : 1;
  return { kit, skill, seed, durationS: devSeconds(), crew, devBrush: app.dev && params.get('brush') === '1', ...ruleOpt };
}
/** CONTRACT_WASHOUT W4: the deep link's rule (?rule=washout; anything else → turf) */
function paramRule(): MatchRule {
  return parseMatchRule(params.get('rule'), 'turf');
}
function devSeconds(): number | null {
  const ms = app.dev ? Number(params.get('matchSeconds')) : NaN;
  return Number.isFinite(ms) && ms >= 5 ? Math.min(1800, ms) : null;
}

// ───────────────────────────── shared (once per page) ─────────────────────────────
interface Shared {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  rig: RendererRig;
  cam: FollowCamera;
  loader: GLTFLoader;
  rapier: Promise<Rapier>;
  hero: Promise<HeroAssets>;
  kitArt: Promise<KitArt>;
  input: Input;
  settings: SettingsStore;
  profile: ProfileStore;
  audio: GameAudio;
  boot: BootUI;
  menus: Menus;
  kits: Map<string, RunnerKit>;
  mannequin: Mannequin | null;
  fpsEl: HTMLElement;
  /** the render quality in force (?quality= for this page, else the saved setting) */
  quality(): RenderQuality;
}

// ───────────────────────────── arena (one resident) ─────────────────────────────
interface Arena {
  key: string;
  def: MapDef;
  presetName: string;
  preset: LightingPreset;
  scene: THREE.Scene;
  geo: MapGeometry;
  atlas: PaintAtlas;
  painter: Painter;
  minimap: MinimapRaster;
  /** the colours object the minimap keeps a reference to (recoloured in place for colorblind marks) */
  mmColors: { base: [number, number, number]; sun: [number, number, number]; gulf: [number, number, number] };
  paint: PaintTexture;
  dye: DyeUniforms;
  map: MapView;
  sky: SkyRig;
  water: WaterRig;
  physics: PhysicsWorld;
  nav: NavGraph;
  atlasMs: number;
  navMs: number;
  dispose(): void;
}

type Report = (f: number, status?: string) => void;

/**
 * Every texture the materials under `root` reference (standard map slots + ShaderMaterial uniforms). The view
 * modules' dispose() methods free geometries and materials; a material's dispose() never frees its textures,
 * so a session / arena swap collects them here first and frees them after (only textures this arena or session
 * made: `own` filters out shared ones).
 */
function texturesOf(root: THREE.Object3D, own: (t: THREE.Texture) => boolean = () => true): Set<THREE.Texture> {
  const out = new Set<THREE.Texture>();
  const scan = (m: THREE.Material): void => {
    for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) out.add(v as THREE.Texture);
    const u = (m as THREE.ShaderMaterial).uniforms;
    if (u) for (const k of Object.keys(u)) { const v = u[k]?.value as THREE.Texture | undefined; if (v && v.isTexture) out.add(v); }
  };
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) scan(m);
  });
  for (const t of [...out]) if (!own(t)) out.delete(t);
  return out;
}

function presetOf(def: MapDef, name: string | null | undefined): { name: string; preset: LightingPreset } {
  const n = name && def.lighting?.presets[name] ? name : (def.lighting?.default ?? 'noon');
  const preset = def.lighting?.presets[n];
  if (!preset) throw new Error(`map '${def.id}' has no lighting preset '${n}'`);
  return { name: n, preset };
}

function mmPalette(colorblind: boolean): Arena['mmColors'] {
  return { base: [226, 219, 204], sun: rgb255(crewColors(1, colorblind).dye), gulf: rgb255(crewColors(2, colorblind).dye) };
}

/** CONTRACT_FFA F3: the minimap raster's 8-crew palette (index = crew id; the FFA dye, no colorblind swap) */
function ffaMinimapPalette(): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [[226, 219, 204]];
  for (const c of FFA_CREWS) out[c.id] = rgb255(c.dye);
  for (let i = 1; i < 9; i++) if (!out[i]) out[i] = [226, 219, 204];
  return out;
}

async function loadArena(S: Shared, mapId: string, presetName: string | null, report: Report): Promise<Arena> {
  const def = mapById(mapId);
  if (def.status !== 'built') throw new Error(`map '${def.id}' is ${def.status}, not built — only built maps can be played`);
  const { name: pname, preset } = presetOf(def, presetName);
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const renderer = S.rig.renderer;
  const prog = { geo: 0, atlas: 0, map: 0, nav: 0 };
  const rep = (status?: string): void => report(prog.geo * 0.16 + prog.atlas * 0.16 + prog.map * 0.3 + prog.nav * 0.2, status);
  rep(`Loading ${def.name ?? def.id}…`);

  // one fetch feeds both parsers (review A-A4); the download is most of the view's share of the bar too
  const bytes = await fetchMapBytes(def, (f) => { prog.geo = f; prog.map = 0.85 * f; rep(); });
  const geo = extractMapGeometry(parseGlb(bytes), def);
  prog.geo = 1;
  rep('Building the paint atlas…');
  await nextFrame();
  const t0 = performance.now();
  const atlas = buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy });
  const atlasMs = performance.now() - t0;
  prog.atlas = 1;
  rep('Loading the arena…');
  const painter = new Painter(atlas);
  const mm = def.minimap ?? { min: [-30, -44] as [number, number], max: [30, 44] as [number, number] };
  const mmColors = mmPalette(S.settings.get().colorblind);
  const minimap = new MinimapRaster(atlas, { min: mm.min, max: mm.max, pxPerMeter: 3, colors: mmColors });
  painter.onFlip = (id) => minimap.apply(id);
  const paint = new PaintTexture(atlas);
  paint.rebuildAll();
  const dye = createDyeUniforms(paint);
  if (dye.uColorblind) dye.uColorblind.value = S.settings.get().colorblind ? 1 : 0;

  const map = await loadMapView(S.loader, def, dye, (f) => { prog.map = Math.max(prog.map, f); rep(); },
    { mergeStatic: !(app.dev && params.get('merge') === '0'), bytes });
  prog.map = 1;
  if (S.settings.get().colorblind) setPadColorblind(map.root, true);
  const scene = new THREE.Scene();
  scene.add(map.root);
  const sky = createSky(scene, renderer, preset);
  const bb = def.bounds;
  const water = createWater(scene, preset, def.waterY ?? -1.4, sky.sunDir,
    bb ? { foamRect: [bb.min[0], bb.min[2], bb.max[0], bb.max[2]] } : {});

  rep('Charting the harbor for the crews…');
  const R = await S.rapier;
  const physics = new PhysicsWorld(R, geo);
  await nextFrame();
  const tn = performance.now();
  const nav = buildNav(geo, physics, def);
  const navMs = performance.now() - tn;
  prog.nav = 1;
  rep();

  let disposed = false;
  return {
    key: `${def.id}:${pname}`, def, presetName: pname, preset, scene, geo, atlas, painter, minimap, mmColors, paint, dye, map, sky, water,
    physics, nav, atlasMs, navMs,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const tex = texturesOf(scene);                  // this arena's map GLB images, AO, shore, dye atlas, water …
      try { sky.dispose(); } catch (e) { console.warn('[dyefield] sky.dispose', e); }
      try { map.dispose(); } catch (e) { console.warn('[dyefield] map.dispose', e); }
      for (const t of tex) t.dispose();
      const wm = water.mesh;
      wm.removeFromParent();
      wm.geometry.dispose();
      for (const m of Array.isArray(wm.material) ? wm.material : [wm.material]) {
        const u = (m as THREE.ShaderMaterial).uniforms;
        if (u) for (const k of Object.keys(u)) { const v = u[k]?.value as THREE.Texture | undefined; if (v && v.isTexture) v.dispose(); }
        m.dispose();
      }
      paint.dispose();
      try { physics.dispose(); } catch (e) { console.warn('[dyefield] physics.dispose', e); }
      scene.clear();
      scene.fog = null;
      scene.background = null;
    },
  };
}

// ───────────────────────────── session (lobby or match) on the arena ─────────────────────────────
interface Session {
  mode: GameMode;
  arena: Arena;
  game: Game;
  players: PlayerViews;
  fx: Fx;
  hud: Hud;
  /** match sessions only */
  juice: Juice | null;
  /** CONTRACT_FFA_SPAWNS S3: the drop-in markers of the FFA spawn sites (FFA match sessions only; no permanent pads) */
  drops: DropMarkers | null;
  /** CONTRACT_MOBILE M2: the touch overlay (match sessions only; shown by the Game in touch mode) */
  touch: TouchControls | null;
  dispose(): void;
}

/** the lobby's backdrop crews: 3 v 3, all bots at BREEZE, a mix of kits */
function lobbyRoster(seed: number): RosterEntry[] {
  const base = defaultRoster({ humanKit: 'sheet-drum', seed, skill: 'breeze', botKits: ['mist-rasp', 'needle-glint', 'pop-well', 'sheet-drum', 'mist-rasp', 'pop-well', 'needle-glint'] });
  const pick = [base[0], base[1], base[2], base[4], base[5], base[6]];
  return pick.map((e, i) => ({ ...e, id: i, team: (i < 3 ? 1 : 2) as TeamId, bot: true, skill: 'breeze' as BotSkill, name: i === 0 ? base[3].name : e.name }));
}

function matchRoster(cfg: MatchConfig): RosterEntry[] {
  if (cfg.mode === 'ffa') {
    // CONTRACT_FFA F1: 8 runners, each its own crew — the human on its colour, bots on the other seven
    return defaultRoster({ humanKit: cfg.kit, humanName: cfg.humanName, seed: cfg.seed, skill: cfg.skill, botKits: mixedBotKits(cfg.kit),
      mode: 'ffa', humanCrew: ffaCrew(cfg.crew ?? 1) });
  }
  const r = defaultRoster({ humanKit: cfg.kit, humanName: cfg.humanName, seed: cfg.seed, skill: cfg.skill, botKits: mixedBotKits(cfg.kit) });
  if (cfg.crew === 2) for (const e of r) e.team = (e.team === 1 ? 2 : 1) as TeamId;
  return r;
}

async function startSession(S: Shared, arena: Arena, mode: GameMode, config: MatchConfig, hooks: GameHooks, report: Report): Promise<Session> {
  const { rig, cam, input, uiRoot } = S;
  const renderer = rig.renderer;
  const def = arena.def;
  report(NaN, 'Loading the tide-runners…');
  const roster = mode === 'lobby' ? lobbyRoster(config.seed) : matchRoster(config);
  const humanTeam = roster[0]?.team ?? 1;
  /** CONTRACT_FFA F3: the match mode of this session (the lobby backdrop is always teams) */
  const matchMode: MatchMode = mode === 'match' && config.mode === 'ffa' ? 'ffa' : 'teams';
  // a clean court for every session; the dye shader + the minimap raster take the mode's palette (an arena may be
  // reused across modes). setPalette repaints the whole raster (the rebuild).
  arena.painter.reset();
  arena.paint.rebuildAll();
  setDyeMode(arena.dye, matchMode);
  arena.minimap.setPalette(matchMode === 'ffa' ? ffaMinimapPalette() : null);
  if (arena.dye.uViewerTeam) arena.dye.uViewerTeam.value = mode === 'lobby' ? 0 : humanTeam;
  if (arena.dye.uColorblind) arena.dye.uColorblind.value = S.settings.get().colorblind ? 1 : 0;
  // the A/B team pads' crew accent follows the setting too (review F1): during an FFA session they are untagged neutral
  // scenery, so a COLORBLIND MARKS toggle then misses them and the FFA markers' dispose restores the accent saved at FFA
  // start — the stale palette on a reused arena (Pier 18 noon = the lobby's) until the next toggle. The previous
  // session is disposed before this runs; an FFA session's addDropMarkers (below) then saves the current palette.
  setPadColorblind(arena.map.root, S.settings.get().colorblind);
  renderer.toneMappingExposure = arena.preset.exposure ?? 1;

  const heroAssets = await S.hero;
  const kitArt = await S.kitArt;
  for (const e of roster) {
    if (!S.kits.has(e.kit)) S.kits.set(e.kit, prepareRunnerKit(heroAssets, { id: e.kit, gltf: kitArt.kits.get(e.kit) ?? null }));
  }
  // CONTRACT_FFA F7: the FX pools, the runner tint / stains / name tags and the juice take the mode's crew palette
  const fx = new Fx(arena.sky.sunDir, matchMode);
  fx.setModels(bakeFxModels(kitArt));
  const players = new PlayerViews(heroAssets, roster, fx, mode === 'lobby' ? null : uiRoot, S.kits, matchMode);
  const st = S.settings.get();
  if (st.colorblind) { fx.setColorblind(true); players.setColorblind(true); }
  arena.scene.add(players.root, fx.root);

  const kitRow = WEAPONS.kits.find((k) => k.id === config.kit) ?? WEAPONS.kits[0];
  const spRow = WEAPONS.specials.find((s) => s.id === kitRow?.special);
  const subRow = WEAPONS.subs.find((s) => s.id === kitRow?.sub);
  const specialName = spRow?.name ?? '';
  const hudKit: HudKit = {
    fire: kitFireType(config.kit),
    specialId: spRow?.id ?? '', specialName, specialKey: input.keyLabel('special'),
    subName: subRow?.name ?? '', subCost: typeof subRow?.tankCost === 'number' ? subRow.tankCost : 70, subKey: input.keyLabel('sub'),
  };
  // CONTRACT_CONTROLS C3 / WASHOUT W5: the HUD's motion (special shake, "+1", PROTECTED shimmer, aim vignette) follows
  // SETTINGS → REDUCE MOTION (live below, applySettings), not only the OS preference
  const hud = new Hud(uiRoot, { team: humanTeam, minimap: arena.minimap, specialName, roster, youId: 0, kit: hudKit, mode: matchMode,
    reduceMotion: st.reduceMotion });
  hud.slates.setLegend(S.menus.legend());
  hud.setTouchMode(input.mode === 'touch');     // CONTRACT_MOBILE M4 platform prompts
  // after the HUD: juice's over-layer (hit marker, confetti) sits above the HUD and the slates
  const juice = mode === 'match' ? createJuice(uiRoot, { reduceMotion: st.reduceMotion, colorblind: st.colorblind, mode: matchMode }) : null;
  // CONTRACT_MOBILE M2: the touch overlay of a match (hidden until the Game shows it in touch mode). PAUSE takes the
  // ESC path (a live match only); a tap on the minimap is the 'map' UI action.
  let touch: TouchControls | null = null;
  if (mode === 'match') {
    touch = new TouchControls(uiRoot, input.touch, touchOptions(st));
    touch.setKit(config.kit);
    touch.onPause(() => {
      const g = app.game;
      if (g && !g.isLobby && app.phase === 'play' && !g.matchOver) g.pause('touch pause');
    });
    touch.onMap(() => input.emitUi('map', new CustomEvent('df-touch-map')));
  }

  const game = new Game({
    app, def, canvas: S.canvas, rig, scene: arena.scene, cam, sky: arena.sky, water: arena.water, map: arena.map, geo: arena.geo,
    atlas: arena.atlas, painter: arena.painter, minimap: arena.minimap, paint: arena.paint, dye: arena.dye, R: await S.rapier,
    physics: arena.physics, nav: arena.nav, roster, players, fx, hud, boot: S.boot, input, config, mode, hooks,
    audio: S.audio, juice, touch,
  }, { quality: S.quality() });
  app.game = game;
  app.mapId = def.id;
  if (mode === 'match') {
    const me = game.human;
    cam.reset(me.yaw);
    cam.update(0, me, arena.physics);
  }
  // CONTRACT_FFA_SPAWNS S3: no permanent FFA pads — a transient drop-in marker per 'spawn' event, built once here for
  // every site of the pool (MatchWorld.spawnSites; PLAY AGAIN keeps the pool). The Game gets the handle before its
  // first tick (the match-start 'spawn' events drain with the first tick's events).
  const drops = matchMode === 'ffa' ? addDropMarkers(arena.map, game.world.spawnSites) : null;
  game.p.drops = drops;

  // shader pre-warm (doctrine §3): compile every program before frame 1 — including the ones that are hidden
  // at spawn (the slick fins, the projectile droplets, the spawn-protection shimmer, the FFA drop-in markers) — then one
  // real frame (which also builds the shadow-depth programs) behind the loading card
  report(NaN, 'Compiling shaders…');
  for (const v of players.views) v.fin.visible = true;
  players.prewarmShields(true);
  drops?.prewarm(true);
  fx.prewarm(true);
  try { await renderer.compileAsync(arena.scene, cam.camera); } catch (e) { console.warn('[dyefield] compileAsync:', e); }
  for (const v of players.views) v.fin.visible = false;
  players.prewarmShields(false);
  drops?.prewarm(false);
  fx.prewarm(false);
  const warmMs = mode === 'lobby' ? game.warm() : 0;
  game.render(0, 1);
  await nextFrame();
  game.render(0, 1);

  const ps = players.stats();
  console.info(`[dyefield] ${VERSION} ${mode} on ${def.id} (${arena.presetName}): atlas ${arena.atlas.size}² · ${arena.atlas.count} texels · overlaps ${arena.atlas.overlaps} · built in ${arena.atlasMs.toFixed(0)} ms; `
    + `map ${arena.map.triangles} tris (${arena.map.paintTriangles} paint); static meshes ${arena.map.merge.before} → ${arena.map.merge.after}; `
    + `physics ${arena.physics.triangles} tris; nav ${arena.nav.nodes} nodes in ${arena.navMs.toFixed(0)} ms; `
    + `runners ${ps.runners} (tris by kit ${Object.entries(ps.kits).map(([k, t]) => `${k} ${t}`).join(', ')}); `
    + `lineup ${roster.map((e) => `${e.id}:${e.kit}:${e.team}`).join(' ')}; `
    + `seed ${config.seed} · bots ${roster[1]?.skill ?? config.skill} · kit ${config.kit}${config.durationS ? ` · ${config.durationS} s` : ''} · mode ${matchMode} · rule ${config.rule ?? 'turf'}; quality ${S.quality()}; `
    + `${mode === 'lobby' ? `backdrop warmed in ${warmMs.toFixed(0)} ms; ` : ''}gpu ${rig.gpu()}`);
  for (const w of [...arena.map.warnings, ...heroAssets.warnings, ...kitArt.warnings, ...players.warnings]) console.warn('[dyefield]', w);

  game.run();
  let disposed = false;
  return {
    mode, arena, game, players, fx, hud, juice, drops, touch,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      game.dispose();
      drops?.dispose();                          // re-tags the A/B team pads; the next startSession re-applies the colorblind setting
      if (app.game === game) app.game = null;
      touch?.dispose();                          // releases every captured touch, removes #df-touch
      // the view modules free their own GPU objects (the runner skeletons' bone textures, the FX disk texture)
      juice?.dispose();
      hud.dispose();
      players.dispose();
      fx.dispose();
      arena.scene.remove(players.root, fx.root);
    },
  };
}

// ───────────────────────────── boot + flows ─────────────────────────────
async function boot(): Promise<void> {
  window.__DF_MAIN__ = true;
  const settings = new SettingsStore();
  const profile = new ProfileStore(WEAPONS.kits.map((k) => k.id), playableMaps().map((m) => m.id));
  applyTeamCssVars(settings.get().colorblind);
  // one WebAudio per page: nothing sounds (and no AudioContext exists) until the first gesture unlocks it
  const audio = createAudio({ volumes: settings.get().volume });
  const bootUi = new BootUI();
  // CONTRACT_FFA F3: a deep link loads a match of one mode — the loading card names it; a bare URL opens the lobby,
  // where the card keeps the both-modes line (boot.ts MODE_LINE_ALL)
  bootUi.setMode(DEEP_LINK ? (parseMatchMode(params.get('mode')) === 'ffa' ? 'ffa' : 'teams') : 'all', DEEP_LINK ? paramRule() : 'turf');
  window.__DF_BOOT__?.handoff();
  let arena: Arena | null = null;
  let session: Session | null = null;
  let busy = false;
  let qualityOverride: RenderQuality | null = null;
  const effectiveQuality = (): RenderQuality => qualityOverride ?? settings.get().quality;
  let S: Shared | null = null;
  let rotate: RotateOverlay | null = null;
  let contextLost = false;
  let uiMapActions = 0;
  const handles: AppHandles = {
    menus: () => S?.menus ?? null, settings: () => settings, profile: () => profile,
    session: () => (session ? {
      mode: session.mode, matchMode: session.game.matchMode, map: session.arena.def.id, preset: session.arena.presetName, key: session.arena.key,
      cam: S ? S.cam.camera.position.toArray().map((v) => Math.round(v * 100) / 100) : null, fov: S ? S.cam.camera.fov : null,
    } : null),
    renderInfo: () => (S ? S.rig.renderer.info : null),
    audio: () => audio.stats(),
    juice: () => session?.juice?.readback() ?? null,
    // CONTRACT_MOBILE M10: { mode, visible, stick {x, y, active}, lookRad {yaw, pitch}, held, buttons [{id, rect, dimmed}],
    // assist {slow, dyaw} } + the extras a harness needs (pinned, the renderer's touch profile, rotate / fullscreen)
    touch: () => {
      if (!S) return null;
      const inp = S.input;
      const rb = session?.touch ? session.touch.readback() : null;
      const g = session?.game ?? null;
      return {
        mode: inp.mode, pinned: inp.pinned, htmlClass: document.documentElement.className,
        visible: rb ? rb.visible : false,
        stick: rb ? rb.stick : { x: 0, y: 0, active: false },
        lookRad: rb ? rb.lookRad : { yaw: 0, pitch: 0 },
        held: rb ? rb.held : [], latched: rb ? rb.latched : [], active: inp.touch.active,
        buttons: rb ? rb.buttons : [],
        assist: g ? { slow: g.assist.slow, dyaw: g.assist.dyaw, dpitch: g.assist.dpitch, foes: g.assist.foes, visibleFoes: g.assist.visible }
          : { slow: 1, dyaw: 0, dpitch: 0, foes: 0, visibleFoes: 0 },
        options: rb ? { leftHanded: rb.leftHanded, scale: rb.scale, opacity: rb.opacity } : null,
        // CONTRACT_CONTROLS C1 / C3: the AIM toggle (state + its light) and the SPECIAL deny shakes played
        aim: rb ? rb.aim : false, aimLit: rb ? rb.aimLit : false, denies: rb ? rb.denies : 0,
        startedBy: app.startedBy,
        renderer: S.rig.mobile(),
        rotateOverlay: rotate ? rotate.shown : null,
        fullscreen: !!document.fullscreenElement,
        contextLost,
        mapActions: uiMapActions,
        // review A-A9 / A-A6 read-backs: the screen wake lock and the back-button trap entry
        wake: { held: !!wake, want: wantWake, requests: wakeRequests },
        backTrap: (history.state as { df?: string } | null)?.df === 'match',
        frameCapSkips: g ? g.capSkips : 0,        // A-A10: rAFs the touch 60 fps cap skipped this session
      };
    },
  };
  installTestSurface(app, handles);

  const fail = (title: string, e: unknown): void => {
    const msg = e instanceof Error ? (e.stack || e.message) : String(e);
    app.phase = 'error';
    app.error = msg;
    S?.menus.hideAll();
    bootUi.error(title, msg);
    console.error('[dyefield]', title, e);
  };
  window.addEventListener('error', (ev) => {
    if (app.phase === 'boot' || app.phase === 'loading') fail('DYEFIELD could not start', ev.error ?? ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    if (app.phase === 'boot' || app.phase === 'loading') fail('DYEFIELD could not start', ev.reason);
  });

  try {
    app.phase = 'loading';
    if (!hasWebGL2()) {
      fail('WebGL 2 is required', 'This browser (or its current settings) does not offer WebGL 2.\n'
        + 'Use an up-to-date Chrome, Edge, Firefox or Safari with hardware acceleration switched on, then reload.');
      return;
    }
    const canvas = document.getElementById('game') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('#game canvas missing from index.html');
    const uiRoot = document.getElementById('ui') ?? document.body;

    // CONTRACT_MOBILE M1: the input method is known BEFORE the WebGL context exists (M7 antialias + touch profile)
    const input = new Input(canvas, settings.get().bindings);
    bootUi.setTouch(input.mode === 'touch');
    // read-back only: 'map' UI actions seen (the M key or a MAP tap on the minimap). No screen consumes 'map' yet
    // (KeyM has been bound with no listener since 1.2.0), so the harness proves the MAP tap reaches it here.
    input.onUi((a) => { if (a === 'map') uiMapActions++; });

    // ?quality= overrides the saved setting for this page only (a harness / share link never rewrites the
    // player's settings); changing QUALITY in SETTINGS ends the override
    const qp = params.get('quality');
    qualityOverride = isRenderQuality(qp) ? qp : null;
    // M7: MSAA off on a touch device with DPR ≥ 2 (fixed at context creation); ?aa=0|1 overrides (A/B measurement)
    const touchAtBoot = input.mode === 'touch';
    const aaQ = params.get('aa');
    const antialias = aaQ === '0' ? false : aaQ === '1' ? true : !(touchAtBoot && (window.devicePixelRatio || 1) >= 2);
    const rig = createRenderer(canvas, (app.dev && params.get('tonemap')) || 'neutral', effectiveQuality(), { touch: touchAtBoot, antialias });
    const cam = new FollowCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    rig.resize(cam.camera);
    // M4: a lost WebGL context pauses and says so (a GPU reset, memory pressure, a long time in the background);
    // a restored context reloads the page — the simplest correct path back
    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      if (contextLost) return;
      contextLost = true;
      const g = app.game;
      if (g && !g.isLobby && app.phase === 'play') g.pause('context lost');
      audio.setPaused(true);
      keepAwake(false);
      input.live = false;
      input.releaseAll();
      app.phase = 'error';
      app.error = 'webglcontextlost';
      S?.menus.hideAll();
      bootUi.error('Graphics were reset by the device', 'The device reset the game’s graphics (the WebGL context was lost).\nPress RELOAD to continue.');
      console.warn('[dyefield] webglcontextlost: the graphics context was lost');
    }, false);
    canvas.addEventListener('webglcontextrestored', () => { location.reload(); }, false);
    // review B-F1: the reset card must SURVIVE a flow that was mid-load when the context went (a lost context during the
    // arena load let startMatch / toLobby / the boot branches finish and replace the card with TAP TO PLAY, the countdown
    // or the menus over a dead canvas): each flow returns straight after its last await while `contextLost` is set.
    // review A-A9: the browser releases a wake lock whenever the page is hidden — take it again on return
    document.addEventListener('visibilitychange', () => { if (wantWake && document.visibilityState === 'visible') keepAwake(true); });

    // the shared loads run while the first arena loads
    const sharedProg = { rapier: 0, hero: 0 };
    let arenaF = 0, lastStatus: string | undefined;
    const report: Report = (f, status) => {
      if (typeof f === 'number' && Number.isFinite(f)) arenaF = f;
      if (status !== undefined) lastStatus = status;
      bootUi.progress(sharedProg.rapier * 0.04 + sharedProg.hero * 0.12 + arenaF * 0.74 + (session ? 0.1 : 0), lastStatus);
    };
    const loader = new GLTFLoader();
    const rapier = loadRapier().then((R) => { sharedProg.rapier = 1; report(NaN); return R; });
    const hero = loadHeroAssets(loader, (f) => { sharedProg.hero = f; report(NaN); }).then((h) => { sharedProg.hero = 1; report(NaN); return h; });
    // the other kits + the sub / special models (heroview already loads kit_mist_rasp.glb: reused below)
    const kitArt = hero.then((h) => loadKitArt(loader, { kit_mist_rasp: h.kit }));
    rapier.catch(() => undefined);
    hero.catch(() => undefined);
    kitArt.catch(() => undefined);

    const fpsEl = document.createElement('div');
    fpsEl.className = 'df-fps';
    fpsEl.hidden = true;
    uiRoot.append(fpsEl);

    // ── flows
    const lobbyConfig = (): MatchConfig => ({ kit: profile.get().kit, skill: 'breeze', seed: randomSeed(), durationS: null, devBrush: false });

    const hooks: GameHooks = {
      paused: (on, msg) => {
        const m = S!.menus;
        // review fix A-A8: HOW TO PLAY from the pause card teaches the running match (a deep link plays ?rule= / ?mode=)
        const g = app.game;
        if (on) m.setMatchRule(g && !g.isLobby ? g.matchMode : null, g && !g.isLobby ? g.rule : null);
        if (on) { if (m.context === 'pause') m.setPauseMessage(msg); else m.showPause(msg); }
        else if (m.context === 'pause') m.hideAll();
      },
      lobby: () => { void toLobby(); },
      overlay: (renderer, dt) => {
        const r = S!.menus.mannequinRect();
        const mq = S!.mannequin;
        if (r && mq) { mq.update(dt); mq.render(renderer, r); }
      },
      frame: (dt) => {
        S!.menus.update(dt);
        fpsTick(dt);
      },
      victory: (el) => { S!.menus.extraScope = el; },
      look: () => ({ sens: settings.get().sensitivity, invertY: settings.get().invertY }),
      assist: () => settings.get().aimAssist,
    };

    /** the play card's gesture: unlock audio; touch mode also goes full screen + landscape (M4) */
    const playClick = (g: Game) => (): void => {
      void audio.unlock();
      if (input.mode === 'touch') { enterFullscreenLandscape(); keepAwake(true); }
      g.requestPlay();
    };

    let fpsT = 0;
    const fpsTick = (dt: number): void => {
      if (fpsEl.hidden) return;
      fpsT -= dt;
      if (fpsT > 0) return;
      fpsT = 0.5;
      const g = app.game;
      fpsEl.textContent = `${g ? Math.round(g.fps) : 0} FPS`;
    };

    const startMatch = async (sel: StartSelection): Promise<void> => {
      if (busy || !S || contextLost) return;
      busy = true;
      if (input.mode === 'touch') {
        // CONTRACT_MOBILE M4: no pointer lock on touch; the START tap is the gesture for full screen + landscape.
        // Review A-A9: the screen stays on through the untouched load; A-A6: the back-button trap entry is pushed inside
        // this gesture (the Game re-arms it at every later play entry).
        enterFullscreenLandscape();
        keepAwake(true);
        armBackTrap();
      } else {
        // the START press is a user gesture: capture the mouse now, so the countdown can start the moment the arena is ready
        try {
          const r = canvas.requestPointerLock({ unadjustedMovement: false } as PointerLockOptions) as unknown;
          if (r && typeof (r as Promise<void>).then === 'function') (r as Promise<void>).catch(() => undefined);
        } catch { /* CLICK TO PLAY covers it */ }
      }
      try {
        const def = mapById(sel.map);
        S.menus.hideAll();
        bootUi.setMode(sel.mode === 'ffa' ? 'ffa' : 'teams', sel.rule === 'washout' ? 'washout' : 'turf');   // FFA F3 / WASHOUT W4: the card names the match being loaded
        bootUi.showLoading(sel.random ? `Random arena: ${def.name}` : `Loading ${def.name}…`, { name: def.name, thumb: MAP_THUMBS[def.id] ?? null });
        app.phase = 'loading';
        arenaF = 0;
        await nextFrame();
        session?.dispose();
        session = null;
        const { name: pname } = presetOf(def, sel.map === 'pier18' ? sel.preset : null);
        const key = `${def.id}:${pname}`;
        if (!arena || arena.key !== key) {
          arena?.dispose();
          arena = null;
          arena = await loadArena(S, def.id, pname, report);
        } else report(1);
        // CONTRACT_FFA F3: FFA → the human's crew is the LOADOUT colour pick
        const ffa = sel.mode === 'ffa';
        const cfg: MatchConfig = {
          kit: sel.kit, skill: sel.skill, seed: randomSeed(), durationS: devSeconds(), humanName: sel.name || undefined,
          crew: ffa ? ffaCrew(sel.ffaColor) : sel.crew, devBrush: false, ...(ffa ? { mode: 'ffa' as const } : {}),
          ...(sel.rule === 'washout' ? { rule: 'washout' as const } : {}),   // CONTRACT_WASHOUT W4: the RULE pick
        };
        session = await startSession(S, arena, 'match', cfg, hooks, report);
        if (contextLost) return;                  // B-F1: the reset card stays
        app.phase = 'ready';
        const g = session.game;
        // touch: straight into the countdown (M4) — unless the phone turned upright while the arena loaded (review A-A2:
        // the match then started and ran under the rotate overlay, and turning back showed no pause card): the TAP TO
        // PLAY card waits behind the overlay, which blocks it until the phone turns back. kbm: into the countdown when
        // the START click's lock is held.
        const began = input.mode === 'touch' ? (!rotate?.shown && g.beginTouch()) : g.beginWithLock();
        if (!began) bootUi.showPlay(playClick(g));
      } catch (e) {
        if (contextLost) return;                  // B-F1: a load that failed on the lost context keeps the reset card
        fail('The match could not start', e);
      } finally {
        busy = false;
      }
    };

    const toLobby = async (): Promise<void> => {
      if (busy || !S || contextLost) return;
      busy = true;
      keepAwake(false);                           // A-A9: the menus may let the phone sleep again
      try {
        if (document.pointerLockElement) document.exitPointerLock();
        S.menus.hideAll();
        S.menus.extraScope = null;
        const def = mapById(LOBBY_MAP);
        bootUi.setMode('all');                    // back to the lobby: no mode committed (the backdrop itself is teams)
        bootUi.showLoading('Back to the harbor…', { name: def.name, thumb: MAP_THUMBS[def.id] ?? null });
        app.phase = 'loading';
        arenaF = 0;
        await nextFrame();
        session?.dispose();
        session = null;
        if (!arena || arena.key !== `${LOBBY_MAP}:${LOBBY_PRESET}`) {
          arena?.dispose();
          arena = null;
          arena = await loadArena(S, LOBBY_MAP, LOBBY_PRESET, report);
        } else report(1);
        session = await startSession(S, arena, 'lobby', lobbyConfig(), hooks, report);
        if (contextLost) return;                  // B-F1: the reset card stays
        app.phase = 'menu';
        app.startedBy = null;
        S.menus.showTitle();
        bootUi.hide();
        audio.playMusic('lobby');                 // resets the match's world loops; the harbour ambience returns
      } catch (e) {
        if (contextLost) return;
        fail('The lobby could not load', e);
      } finally {
        busy = false;
      }
    };

    // UI sounds (hover / click / back / start): the UI bus is never ducked or paused; a click also unlocks
    const menus = new Menus(uiRoot, {
      settings, profile, input,
      hooks: {
        start: (sel) => { void startMatch(sel); },
        resume: () => app.game?.resume(),
        quitMatch: () => { void toLobby(); },
        padStart: () => { const g = app.game; if (g && !g.isLobby && app.phase === 'play' && !g.matchOver) g.pause('pad'); },
        sound: (s) => audio.ui(s),
      },
    });
    S = { canvas, uiRoot, rig, cam, loader, rapier, hero, kitArt, input, settings, profile, audio, boot: bootUi, menus, kits: new Map(), mannequin: null, fpsEl,
      quality: effectiveQuality };
    const shared = S;

    // ESC / P (the 'pause' action): pause a live match; on the pause card a non-ESC pause key goes back
    input.onUi((a, e) => {
      if (a !== 'pause') return;
      const g = app.game;
      if (!g || g.isLobby) return;
      if (app.phase === 'play' && !g.matchOver) { menus.handledEvent = e; g.pause('esc'); }
      else if (app.phase === 'paused' && (e as KeyboardEvent).code !== 'Escape') menus.back();
    });

    // settings → live
    const applySettings = (s: Readonly<Settings>, keys: ReadonlyArray<keyof Settings>): void => {
      const all = keys.length === 0;
      const has = (k: keyof Settings): boolean => all || keys.includes(k);
      if (has('bindings')) {
        input.setBindings(s.bindings);
        const hud = session?.hud;
        if (hud) { hud.setKeys(input.keyLabel('special'), input.keyLabel('sub')); hud.slates.setLegend(menus.legend()); }
      }
      if (has('colorblind')) {
        applyTeamCssVars(s.colorblind);
        if (session) { session.fx.setColorblind(s.colorblind); session.players.setColorblind(s.colorblind); session.juice?.setColorblind(s.colorblind); }
        if (arena) {
          if (arena.dye.uColorblind) arena.dye.uColorblind.value = s.colorblind ? 1 : 0;
          setPadColorblind(arena.map.root, s.colorblind);
          const pal = mmPalette(s.colorblind);
          arena.mmColors.sun.splice(0, 3, ...pal.sun);
          arena.mmColors.gulf.splice(0, 3, ...pal.gulf);
          arena.minimap.rebuild();
          session?.hud.redrawMinimapNow();
        }
        const pr = profile.get();
        shared.mannequin?.setTeam(pr.mode === 'ffa' ? pr.ffaColor : pr.crew);
      }
      if (has('quality') && !all) {
        qualityOverride = null;
        if (app.game) app.game.setQuality(s.quality); else rig.setQuality(s.quality);
      }
      if (has('showFps')) fpsEl.hidden = !s.showFps;
      const c = cam as FollowCamera & { sensitivityScale?: number; invertY?: boolean; reduceMotion?: boolean };
      if (has('sensitivity') && 'sensitivityScale' in c) c.sensitivityScale = s.sensitivity;
      if (has('invertY') && 'invertY' in c) c.invertY = s.invertY;
      // CONTRACT_CONTROLS C1: the aim look multiplier (camera) and hold / toggle (input), live
      if (has('aimSens')) cam.aimSens = s.aimSens;
      if (has('aimToggle')) input.aimToggle = s.aimToggle;
      if (has('reduceMotion')) {
        if ('reduceMotion' in c) c.reduceMotion = s.reduceMotion;
        session?.juice?.setReduceMotion(s.reduceMotion);   // juice also pushes it to the camera every frame
        session?.hud.setReduceMotion(s.reduceMotion);
      }
      if (has('volume')) audio.setVolumes(s.volume);
      // CONTRACT_MOBILE M8: the touch rows apply live (aimAssist is read by the Game every frame)
      if (has('touchSens') || has('touchScale') || has('touchOpacity') || has('touchLeftHanded') || has('haptics')) {
        session?.touch?.setOptions(touchOptions(s));
      }
    };
    settings.on(applySettings);
    applySettings(settings.get(), []);

    // CONTRACT_MOBILE M1: a hybrid device switched input method — the prompts, the play card and the renderer's
    // profile follow (the overlay itself follows every frame through the Game)
    const applyMode = (m: InputMode): void => {
      const on = m === 'touch';
      bootUi.setTouch(on);
      menus.setTouchMode(on);
      session?.hud.setTouchMode(on);
      rig.setTouchProfile(on);
    };
    input.onMode(applyMode);
    menus.setTouchMode(input.mode === 'touch');

    // CONTRACT_MOBILE M4: portrait on a touch device → the rotate overlay; a live match pauses under it (no auto-resume:
    // turning back shows the pause card)
    rotate = new RotateOverlay((shown) => {
      if (!shown) return;
      const g = app.game;
      if (g && !g.isLobby && app.phase === 'play' && !g.matchOver) g.pause('rotate');
    });

    // the LOADOUT mannequin, once the hero + kits are in
    void Promise.all([hero, kitArt]).then(([h, k]) => {
      // the LOADOUT mannequin wears the profile's pick: the crew (teams) or the FFA colour (CONTRACT_FFA F3)
      const m = new Mannequin(rig.renderer, h, k, (t) => (profile.get().mode === 'ffa' ? crewLook(t, 'ffa').dye : crewColors(t, settings.get().colorblind).dye));
      shared.mannequin = m;
      menus.setMannequin(m);
    }).catch((e) => console.warn('[dyefield] mannequin unavailable:', e));

    if (DEEP_LINK) {
      // ── a direct match (harnesses, share links). A-A9: the wake lock is best effort here (no gesture yet; the spec
      // does not require one) and asked for again by the TAP TO PLAY tap.
      if (input.mode === 'touch') keepAwake(true);
      const def = mapById(app.mapId);
      arena = await loadArena(shared, def.id, params.get('preset'), report);
      session = await startSession(shared, arena, 'match', paramConfig(), hooks, report);
      if (contextLost) return;                    // B-F1: the reset card stays (?autostart included)
      audio.preload();                            // A-A11: the audio downloads start once the arena no longer needs the bandwidth
      bootUi.progress(1, 'Ready');
      app.phase = 'ready';
      const g = session.game;
      bootUi.showPlay(playClick(g));
      if (params.get('autostart') === '1') g.devStart();
    } else {
      // ── the lobby: Pier 18 at noon behind the menus
      arena = await loadArena(shared, LOBBY_MAP, LOBBY_PRESET, report);
      session = await startSession(shared, arena, 'lobby', lobbyConfig(), hooks, report);
      if (contextLost) return;                    // B-F1: the reset card stays (the most common entry path)
      audio.preload();                            // A-A11: after the lobby's map GLB, never beside it
      bootUi.progress(1, 'Ready');
      app.phase = 'menu';
      menus.showTitle();
      bootUi.hide();
      audio.playMusic('lobby');                   // queued until the first gesture unlocks the context
    }
  } catch (e) {
    if (contextLost) return;                      // B-F1: a boot load that failed on the lost context keeps the reset card
    fail('DYEFIELD could not start', e);
  }
}

boot();
