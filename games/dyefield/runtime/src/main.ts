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

/// <reference types="vite/client" />

import '@fontsource/lilita-one/400.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import './ui/styles.css';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mapById, teamById, hexToRgb01, WEAPONS, playableMaps, type LightingPreset, type MapDef } from './core/data.ts';
import type { TeamId } from './core/types.ts';
import { loadMapGeometry, type MapGeometry } from './core/mapgeo.ts';
import { buildAtlas, type PaintAtlas } from './core/paint/atlas.ts';
import { Painter } from './core/paint/painter.ts';
import { MinimapRaster } from './core/paint/minimap.ts';
import { loadRapier, PhysicsWorld, type Rapier } from './core/physics.ts';
import { defaultRoster, parseBotSkill, type BotSkill, type RosterEntry } from './core/match/roster.ts';
import { buildNav, type NavGraph } from './core/bots/nav.ts';
import { createRenderer, hasWebGL2, isRenderQuality, type RenderQuality, type RendererRig } from './view/renderer.ts';
import { FollowCamera } from './view/camera.ts';
import { createSky, type SkyRig } from './view/sky.ts';
import { createWater, type WaterRig } from './view/water.ts';
import { PaintTexture } from './view/paintlayer.ts';
import { createDyeUniforms, type DyeUniforms } from './view/surfaces.ts';
import { loadMapView, type MapView } from './view/mapview.ts';
import { loadHeroAssets, type HeroAssets } from './view/heroview.ts';
import { PlayerViews, prepareRunnerKit, loadKitArt, mixedBotKits, kitFireType, type RunnerKit, type KitArt } from './view/players.ts';
import { Fx, bakeFxModels } from './view/fx.ts';
import { Hud, applyTeamCssVars, type HudKit } from './ui/hud.ts';
import { BootUI } from './ui/boot.ts';
import { Menus, crewColors, type StartSelection } from './ui/menus.ts';
import { SettingsStore, ProfileStore, type Settings } from './ui/settings.ts';
import { Mannequin } from './ui/mannequin.ts';
import { MAP_THUMBS } from './ui/icons.ts';
import { Input } from './input.ts';
import { Game, type AppStatus, type GameHooks, type GameMode, type MatchConfig } from './game.ts';
import { installTestSurface, type AppHandles } from './testsurface.ts';

export const VERSION = 'dyefield-0.9.0-phase9';

declare global {
  interface Window {
    __DF_MAIN__?: boolean;
    __DF_BOOT__?: { handoff(): void; fail(title: string, detail: string): void };
  }
}

const params = new URLSearchParams(location.search);
const DEEP_KEYS = ['map', 'kit', 'bots', 'seed', 'matchSeconds', 'preset', 'autostart', 'brush', 'crew'];
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
  const crew: TeamId = cq === '2' || cq === 'gulf' ? 2 : 1;
  return { kit, skill, seed, durationS: devSeconds(), crew, devBrush: app.dev && params.get('brush') === '1' };
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
/** procedural textures (DataTexture / CanvasTexture) — per-session objects, never the shared GLB images */
const procedural = (t: THREE.Texture): boolean => (t as THREE.DataTexture).isDataTexture === true || (t as THREE.CanvasTexture).isCanvasTexture === true;

function presetOf(def: MapDef, name: string | null | undefined): { name: string; preset: LightingPreset } {
  const n = name && def.lighting?.presets[name] ? name : (def.lighting?.default ?? 'noon');
  const preset = def.lighting?.presets[n];
  if (!preset) throw new Error(`map '${def.id}' has no lighting preset '${n}'`);
  return { name: n, preset };
}

function mmPalette(colorblind: boolean): Arena['mmColors'] {
  return { base: [226, 219, 204], sun: rgb255(crewColors(1, colorblind).dye), gulf: rgb255(crewColors(2, colorblind).dye) };
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

  const geo = await loadMapGeometry(def);
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

  const map = await loadMapView(S.loader, def, dye, (f) => { prog.map = f; rep(); },
    { mergeStatic: !(app.dev && params.get('merge') === '0') });
  prog.map = 1;
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
  dispose(): void;
}

/** the lobby's backdrop crews: 3 v 3, all bots at BREEZE, a mix of kits */
function lobbyRoster(seed: number): RosterEntry[] {
  const base = defaultRoster({ humanKit: 'sheet-drum', seed, skill: 'breeze', botKits: ['mist-rasp', 'needle-glint', 'pop-well', 'sheet-drum', 'mist-rasp', 'pop-well', 'needle-glint'] });
  const pick = [base[0], base[1], base[2], base[4], base[5], base[6]];
  return pick.map((e, i) => ({ ...e, id: i, team: (i < 3 ? 1 : 2) as TeamId, bot: true, skill: 'breeze' as BotSkill, name: i === 0 ? base[3].name : e.name }));
}

function matchRoster(cfg: MatchConfig): RosterEntry[] {
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
  // a clean court for every session
  arena.painter.reset();
  arena.paint.rebuildAll();
  arena.minimap.rebuild();
  if (arena.dye.uViewerTeam) arena.dye.uViewerTeam.value = mode === 'lobby' ? 0 : humanTeam;
  if (arena.dye.uColorblind) arena.dye.uColorblind.value = S.settings.get().colorblind ? 1 : 0;
  renderer.toneMappingExposure = arena.preset.exposure ?? 1;

  const heroAssets = await S.hero;
  const kitArt = await S.kitArt;
  for (const e of roster) {
    if (!S.kits.has(e.kit)) S.kits.set(e.kit, prepareRunnerKit(heroAssets, { id: e.kit, gltf: kitArt.kits.get(e.kit) ?? null }));
  }
  const fx = new Fx(arena.sky.sunDir);
  fx.setModels(bakeFxModels(kitArt));
  const players = new PlayerViews(heroAssets, roster, fx, mode === 'lobby' ? null : uiRoot, S.kits);
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
  const hud = new Hud(uiRoot, { team: humanTeam, minimap: arena.minimap, specialName, roster, youId: 0, kit: hudKit });
  hud.slates.setLegend(S.menus.legend());

  const game = new Game({
    app, def, canvas: S.canvas, rig, scene: arena.scene, cam, sky: arena.sky, water: arena.water, map: arena.map, geo: arena.geo,
    atlas: arena.atlas, painter: arena.painter, minimap: arena.minimap, paint: arena.paint, dye: arena.dye, R: await S.rapier,
    physics: arena.physics, nav: arena.nav, roster, players, fx, hud, boot: S.boot, input, config, mode, hooks,
  }, { quality: S.quality() });
  app.game = game;
  app.mapId = def.id;
  if (mode === 'match') {
    const me = game.human;
    cam.reset(me.yaw);
    cam.update(0, me, arena.physics);
  }

  // shader pre-warm (doctrine §3): compile every program before frame 1 — including the ones that are hidden
  // at spawn (the slick fins, the projectile droplets) — then one real frame (which also builds the
  // shadow-depth programs) behind the loading card
  report(NaN, 'Compiling shaders…');
  for (const v of players.views) v.fin.visible = true;
  fx.prewarm(true);
  try { await renderer.compileAsync(arena.scene, cam.camera); } catch (e) { console.warn('[dyefield] compileAsync:', e); }
  for (const v of players.views) v.fin.visible = false;
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
    + `seed ${config.seed} · bots ${roster[1]?.skill ?? config.skill} · kit ${config.kit}${config.durationS ? ` · ${config.durationS} s` : ''}; quality ${S.quality()}; `
    + `${mode === 'lobby' ? `backdrop warmed in ${warmMs.toFixed(0)} ms; ` : ''}gpu ${rig.gpu()}`);
  for (const w of [...arena.map.warnings, ...heroAssets.warnings, ...kitArt.warnings, ...players.warnings]) console.warn('[dyefield]', w);

  game.run();
  let disposed = false;
  return {
    mode, arena, game, players, fx, hud,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      game.dispose();
      if (app.game === game) app.game = null;
      const tex = new Set([...texturesOf(players.root, procedural), ...texturesOf(fx.root, procedural)]);
      // each runner is a SkeletonUtils clone with its own Skeleton, whose bone DataTexture only Skeleton.dispose() frees
      const skeletons = new Set<THREE.Skeleton>();
      players.root.traverse((o) => { const sm = o as THREE.SkinnedMesh; if (sm.isSkinnedMesh && sm.skeleton) skeletons.add(sm.skeleton); });
      hud.dispose();
      players.dispose();
      fx.dispose();
      arena.scene.remove(players.root, fx.root);
      for (const t of tex) t.dispose();
      for (const k of skeletons) k.dispose();
    },
  };
}

// ───────────────────────────── boot + flows ─────────────────────────────
async function boot(): Promise<void> {
  window.__DF_MAIN__ = true;
  const settings = new SettingsStore();
  const profile = new ProfileStore(WEAPONS.kits.map((k) => k.id), playableMaps().map((m) => m.id));
  applyTeamCssVars(settings.get().colorblind);
  const bootUi = new BootUI();
  window.__DF_BOOT__?.handoff();
  let arena: Arena | null = null;
  let session: Session | null = null;
  let busy = false;
  let qualityOverride: RenderQuality | null = null;
  const effectiveQuality = (): RenderQuality => qualityOverride ?? settings.get().quality;
  let S: Shared | null = null;
  const handles: AppHandles = {
    menus: () => S?.menus ?? null, settings: () => settings, profile: () => profile,
    session: () => (session ? {
      mode: session.mode, map: session.arena.def.id, preset: session.arena.presetName, key: session.arena.key,
      cam: S ? S.cam.camera.position.toArray().map((v) => Math.round(v * 100) / 100) : null, fov: S ? S.cam.camera.fov : null,
    } : null),
    renderInfo: () => (S ? S.rig.renderer.info : null),
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

    // ?quality= overrides the saved setting for this page only (a harness / share link never rewrites the
    // player's settings); changing QUALITY in SETTINGS ends the override
    const qp = params.get('quality');
    qualityOverride = isRenderQuality(qp) ? qp : null;
    const rig = createRenderer(canvas, (app.dev && params.get('tonemap')) || 'neutral', effectiveQuality());
    const cam = new FollowCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    rig.resize(cam.camera);

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

    const input = new Input(canvas, settings.get().bindings);
    const fpsEl = document.createElement('div');
    fpsEl.className = 'df-fps';
    fpsEl.hidden = true;
    uiRoot.append(fpsEl);

    // ── flows
    const lobbyConfig = (): MatchConfig => ({ kit: profile.get().kit, skill: 'breeze', seed: randomSeed(), durationS: null, devBrush: false });

    const hooks: GameHooks = {
      paused: (on, msg) => {
        const m = S!.menus;
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
      if (busy || !S) return;
      busy = true;
      // the START press is a user gesture: capture the mouse now, so the countdown can start the moment the arena is ready
      try {
        const r = canvas.requestPointerLock({ unadjustedMovement: false } as PointerLockOptions) as unknown;
        if (r && typeof (r as Promise<void>).then === 'function') (r as Promise<void>).catch(() => undefined);
      } catch { /* CLICK TO PLAY covers it */ }
      try {
        const def = mapById(sel.map);
        S.menus.hideAll();
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
        const cfg: MatchConfig = {
          kit: sel.kit, skill: sel.skill, seed: randomSeed(), durationS: devSeconds(), humanName: sel.name || undefined, crew: sel.crew, devBrush: false,
        };
        session = await startSession(S, arena, 'match', cfg, hooks, report);
        app.phase = 'ready';
        const g = session.game;
        if (!g.beginWithLock()) bootUi.showPlay(() => g.requestPlay());
      } catch (e) {
        fail('The match could not start', e);
      } finally {
        busy = false;
      }
    };

    const toLobby = async (): Promise<void> => {
      if (busy || !S) return;
      busy = true;
      try {
        if (document.pointerLockElement) document.exitPointerLock();
        S.menus.hideAll();
        S.menus.extraScope = null;
        const def = mapById(LOBBY_MAP);
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
        app.phase = 'menu';
        app.startedBy = null;
        S.menus.showTitle();
        bootUi.hide();
        // (integrator: the lobby cue — audio.playMusic('lobby') — belongs here and after the first lobby below)
      } catch (e) {
        fail('The lobby could not load', e);
      } finally {
        busy = false;
      }
    };

    // integrator: UI sounds are one hook — add `sound: (s) => audio.ui(s)` to these hooks — and the volumes one
    // listener: settings.on((s, k) => { if (k.includes('volume')) audio.setVolumes(s.volume); })
    const menus = new Menus(uiRoot, {
      settings, profile, input,
      hooks: {
        start: (sel) => { void startMatch(sel); },
        resume: () => app.game?.resume(),
        quitMatch: () => { void toLobby(); },
        padStart: () => { const g = app.game; if (g && !g.isLobby && app.phase === 'play' && !g.matchOver) g.pause('pad'); },
      },
    });
    S = { canvas, uiRoot, rig, cam, loader, rapier, hero, kitArt, input, settings, profile, boot: bootUi, menus, kits: new Map(), mannequin: null, fpsEl,
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
        if (arena) {
          if (arena.dye.uColorblind) arena.dye.uColorblind.value = s.colorblind ? 1 : 0;
          const pal = mmPalette(s.colorblind);
          arena.mmColors.sun.splice(0, 3, ...pal.sun);
          arena.mmColors.gulf.splice(0, 3, ...pal.gulf);
          arena.minimap.rebuild();
          session?.hud.redrawMinimapNow();
        }
        shared.mannequin?.setTeam(profile.get().crew);
      }
      if (has('quality') && !all) {
        qualityOverride = null;
        if (app.game) app.game.setQuality(s.quality); else rig.setQuality(s.quality);
      }
      if (has('showFps')) fpsEl.hidden = !s.showFps;
      const c = cam as FollowCamera & { sensitivityScale?: number; invertY?: boolean; reduceMotion?: boolean };
      if (has('sensitivity') && 'sensitivityScale' in c) c.sensitivityScale = s.sensitivity;
      if (has('invertY') && 'invertY' in c) c.invertY = s.invertY;
      if (has('reduceMotion') && 'reduceMotion' in c) c.reduceMotion = s.reduceMotion;
    };
    settings.on(applySettings);
    applySettings(settings.get(), []);

    // the LOADOUT mannequin, once the hero + kits are in
    void Promise.all([hero, kitArt]).then(([h, k]) => {
      const m = new Mannequin(rig.renderer, h, k, (t) => crewColors(t, settings.get().colorblind).dye);
      shared.mannequin = m;
      menus.setMannequin(m);
    }).catch((e) => console.warn('[dyefield] mannequin unavailable:', e));

    if (DEEP_LINK) {
      // ── a direct match (harnesses, share links)
      const def = mapById(app.mapId);
      arena = await loadArena(shared, def.id, params.get('preset'), report);
      session = await startSession(shared, arena, 'match', paramConfig(), hooks, report);
      bootUi.progress(1, 'Ready');
      app.phase = 'ready';
      const g = session.game;
      bootUi.showPlay(() => g.requestPlay());
      if (params.get('autostart') === '1') g.devStart();
    } else {
      // ── the lobby: Pier 18 at noon behind the menus
      arena = await loadArena(shared, LOBBY_MAP, LOBBY_PRESET, report);
      session = await startSession(shared, arena, 'lobby', lobbyConfig(), hooks, report);
      bootUi.progress(1, 'Ready');
      app.phase = 'menu';
      menus.showTitle();
      bootUi.hide();
    }
  } catch (e) {
    fail('DYEFIELD could not start', e);
  }
}

boot();
