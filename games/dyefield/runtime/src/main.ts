// DYEFIELD — boot: params → WebGL2 check → loading card → parallel loads (Rapier, map geometry +
// paint atlas, map GLB view, tide-runner + kit) → physics + bot nav graph → the 8-runner match
// (roster, merged runner views, FX, HUD) → shader pre-warm → CLICK TO PLAY → countdown → play.
// Query params (CONTRACT §6, §11): ?map=pier18 · ?dev=1 · ?preset=noon|golden · ?seed=N ·
//   ?kit=mist-rasp · ?bots=chill|fresh|fierce · ?autostart=1 (skip the CLICK TO PLAY card; a click on
//   the view captures the mouse) · ?quality=auto|high|low
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
import { mapById, teamById, hexToRgb01, WEAPONS, type LightingPreset } from './core/data.ts';
import { loadMapGeometry } from './core/mapgeo.ts';
import { buildAtlas } from './core/paint/atlas.ts';
import { Painter } from './core/paint/painter.ts';
import { MinimapRaster } from './core/paint/minimap.ts';
import { loadRapier, PhysicsWorld } from './core/physics.ts';
import { defaultRoster, type BotSkill } from './core/match/roster.ts';
import { buildNav } from './core/bots/nav.ts';
import { createRenderer, hasWebGL2, isRenderQuality, type RenderQuality } from './view/renderer.ts';
import { FollowCamera } from './view/camera.ts';
import { createSky } from './view/sky.ts';
import { createWater } from './view/water.ts';
import { PaintTexture } from './view/paintlayer.ts';
import { createDyeUniforms } from './view/surfaces.ts';
import { loadMapView } from './view/mapview.ts';
import { loadHeroAssets } from './view/heroview.ts';
import { PlayerViews, prepareRunnerKit } from './view/players.ts';
import { Fx } from './view/fx.ts';
import { Hud, applyTeamCssVars } from './ui/hud.ts';
import { BootUI } from './ui/boot.ts';
import { Input } from './input.ts';
import { Game, type AppStatus, type MatchConfig } from './game.ts';
import { installTestSurface } from './testsurface.ts';

export const VERSION = 'dyefield-0.5.0-phase5';

declare global {
  interface Window {
    __DF_MAIN__?: boolean;
    __DF_BOOT__?: { handoff(): void; fail(title: string, detail: string): void };
  }
}

const params = new URLSearchParams(location.search);
const app: AppStatus = {
  phase: 'boot',
  mapId: params.get('map') || 'pier18',
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

/** ?kit ?bots ?seed ?matchSeconds ?brush → the match settings */
function matchConfig(): MatchConfig {
  const kitQ = params.get('kit') || 'mist-rasp';
  let kit = kitQ;
  if (!WEAPONS.kits.some((k) => k.id === kitQ)) {
    console.info(`[dyefield] ?kit=${kitQ} is not a kit in weapons.json (${WEAPONS.kits.map((k) => k.id).join(', ')}) — using mist-rasp`);
    kit = 'mist-rasp';
  }
  const b = params.get('bots');
  const skill: BotSkill = b === 'chill' || b === 'fierce' || b === 'fresh' ? b : 'fresh';
  const sq = params.get('seed');
  const seed = sq !== null && sq !== '' && Number.isFinite(Number(sq)) ? (Number(sq) >>> 0) : ((Math.random() * 0x7fffffff) >>> 0);
  const ms = app.dev ? Number(params.get('matchSeconds')) : NaN;
  const durationS = Number.isFinite(ms) && ms >= 5 ? Math.min(1800, ms) : null;
  return { kit, skill, seed, durationS, devBrush: app.dev && params.get('brush') === '1' };
}

async function boot(): Promise<void> {
  window.__DF_MAIN__ = true;
  installTestSurface(app);
  applyTeamCssVars();
  const bootUi = new BootUI();
  window.__DF_BOOT__?.handoff();

  const fail = (title: string, e: unknown): void => {
    const msg = e instanceof Error ? (e.stack || e.message) : String(e);
    app.phase = 'error';
    app.error = msg;
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
    const def = mapById(app.mapId);
    if (def.status !== 'built') throw new Error(`map '${def.id}' is ${def.status}, not built — only built maps can be played`);
    const presetName = params.get('preset') || def.lighting?.default || 'noon';
    const preset: LightingPreset | undefined = def.lighting?.presets[presetName] ?? def.lighting?.presets[def.lighting.default];
    if (!preset) throw new Error(`map '${def.id}' has no lighting preset '${presetName}'`);
    const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
    const config = matchConfig();

    const canvas = document.getElementById('game') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('#game canvas missing from index.html');
    const uiRoot = document.getElementById('ui') ?? document.body;

    const prog = { rapier: 0, geo: 0, atlas: 0, map: 0, hero: 0, nav: 0, warm: 0 };
    const report = (status?: string): void => {
      const f = prog.rapier * 0.06 + prog.geo * 0.14 + prog.atlas * 0.14 + prog.map * 0.22 + prog.hero * 0.16 + prog.nav * 0.18 + prog.warm * 0.1;
      bootUi.progress(f, status);
    };
    report(`Loading ${def.name ?? def.id}…`);

    const qp = params.get('quality');
    const quality: RenderQuality = isRenderQuality(qp) ? qp : 'auto';
    const rig = createRenderer(canvas, (app.dev && params.get('tonemap')) || 'neutral', quality);
    const renderer = rig.renderer;
    const scene = new THREE.Scene();
    const cam = new FollowCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    rig.resize(cam.camera);

    const loader = new GLTFLoader();
    const rapierP = loadRapier().then((R) => { prog.rapier = 1; report(); return R; });
    const geoP = loadMapGeometry(def).then((g) => { prog.geo = 1; report('Building the paint atlas…'); return g; });
    const heroP = loadHeroAssets(loader, (f) => { prog.hero = f; report(); }).then((h) => { prog.hero = 1; report(); return h; });
    rapierP.catch(() => undefined);
    heroP.catch(() => undefined);

    const geo = await geoP;
    await nextFrame();
    const t0 = performance.now();
    const atlas = buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy });
    const atlasMs = performance.now() - t0;
    prog.atlas = 1;
    report('Loading the arena…');
    const painter = new Painter(atlas);
    const sun = teamById(1), gulf = teamById(2);
    const mm = def.minimap ?? { min: [-30, -44] as [number, number], max: [30, 44] as [number, number] };
    const minimap = new MinimapRaster(atlas, {
      min: mm.min, max: mm.max, pxPerMeter: 3,
      colors: { base: [226, 219, 204], sun: rgb255(sun.dye), gulf: rgb255(gulf.dye) },
    });
    painter.onFlip = (id) => minimap.apply(id);
    const paint = new PaintTexture(atlas);
    paint.rebuildAll();
    const dye = createDyeUniforms(paint);
    const viewer = dye.uViewerTeam;
    if (viewer) viewer.value = 1;

    const map = await loadMapView(loader, def, dye, (f) => { prog.map = f; report(); },
      { mergeStatic: !(app.dev && params.get('merge') === '0') });
    prog.map = 1;
    scene.add(map.root);
    const sky = createSky(scene, renderer, preset);
    const bb = def.bounds;
    const water = createWater(scene, preset, def.waterY ?? -1.4, sky.sunDir,
      bb ? { foamRect: [bb.min[0], bb.min[2], bb.max[0], bb.max[2]] } : {});
    renderer.toneMappingExposure = preset.exposure ?? 1;

    report('Charting the harbor for the crews…');
    const R = await rapierP;
    const physics = new PhysicsWorld(R, geo);
    await nextFrame();
    const tn = performance.now();
    const nav = buildNav(geo, physics, def);
    const navMs = performance.now() - tn;
    prog.nav = 1;
    report('Loading the tide-runners…');

    const roster = defaultRoster({ humanKit: config.kit, seed: config.seed, skill: config.skill });
    const heroAssets = await heroP;
    const kitGeo = prepareRunnerKit(heroAssets);
    const fx = new Fx(sky.sunDir);
    const players = new PlayerViews(heroAssets, roster, fx, uiRoot, kitGeo);
    scene.add(players.root, fx.root);

    const input = new Input(canvas);
    const kitRow = WEAPONS.kits.find((k) => k.id === config.kit) ?? WEAPONS.kits[0];
    const specialName = WEAPONS.specials.find((s) => s.id === kitRow?.special)?.name ?? '';
    const hud = new Hud(uiRoot, { team: 1, minimap, specialName, roster, youId: 0 });

    const game = new Game({
      app, def, canvas, rig, scene, cam, sky, water, map, geo, atlas, painter, minimap, paint, dye, R, physics, nav,
      roster, players, fx, hud, boot: bootUi, input, config,
    }, { quality });
    app.game = game;
    const me = game.human;
    cam.reset(me.yaw);
    cam.update(0, me, physics);

    // shader pre-warm (doctrine §3): compile every program before frame 1 — including the ones that
    // are hidden at spawn (the slick fins, the projectile droplets) — then one real frame (which also
    // builds the shadow-depth programs) behind the loading card
    report('Compiling shaders…');
    for (const v of players.views) v.fin.visible = true;
    fx.drops.count = 1;
    try { await renderer.compileAsync(scene, cam.camera); } catch (e) { console.warn('[dyefield] compileAsync:', e); }
    for (const v of players.views) v.fin.visible = false;
    fx.drops.count = 0;
    game.render(0, 1);
    await nextFrame();
    game.render(0, 1);
    prog.warm = 1;
    report('Ready');

    const ps = players.stats();
    console.info(`[dyefield] ${VERSION} map ${def.id}: atlas ${atlas.size}² · ${atlas.count} texels · overlaps ${atlas.overlaps} · built in ${atlasMs.toFixed(0)} ms; `
      + `map ${map.triangles} tris (${map.paintTriangles} paint); static meshes ${map.merge.before} → ${map.merge.after}; `
      + `physics ${physics.triangles} tris; nav ${nav.nodes} nodes in ${navMs.toFixed(0)} ms; `
      + `runners ${ps.runners} × ${Math.round(ps.bodyTris)} tris (1 merged skinned mesh each); `
      + `match seed ${config.seed} · bots ${config.skill} · kit ${config.kit}${config.durationS ? ` · ${config.durationS} s` : ''}; quality ${quality}; gpu ${rig.gpu()}`);
    for (const w of [...map.warnings, ...heroAssets.warnings, ...players.warnings]) console.warn('[dyefield]', w);

    app.phase = 'ready';
    bootUi.showPlay(() => game.requestPlay());
    game.run();
    if (params.get('autostart') === '1') game.devStart();
  } catch (e) {
    fail('DYEFIELD could not start', e);
  }
}

boot();
