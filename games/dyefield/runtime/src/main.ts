// DYEFIELD — boot: params → WebGL2 check → loading card → parallel loads (Rapier, map geometry +
// paint atlas, map GLB view, tide-runner + kit) → shader pre-warm → CLICK TO PLAY → play.
// Query params (CONTRACT §6): ?map=pier18 · ?dev=1 · ?preset=noon|golden · ?seed=N
// plus ?quality=auto|high|low (the render-quality settings hook; default auto = adaptive resolution)
// and, dev-only, ?merge=0 (keep static map meshes unmerged — perf A/B) and ?tonemap=…
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
import { mapById, teamById, hexToRgb01, type LightingPreset } from './core/data.ts';
import { MOVE } from './core/config.ts';
import { loadMapGeometry } from './core/mapgeo.ts';
import { buildAtlas } from './core/paint/atlas.ts';
import { Painter } from './core/paint/painter.ts';
import { MinimapRaster } from './core/paint/minimap.ts';
import { loadRapier, PhysicsWorld } from './core/physics.ts';
import { Player } from './core/player.ts';
import { createRenderer, hasWebGL2, isRenderQuality, type RenderQuality } from './view/renderer.ts';
import { FollowCamera } from './view/camera.ts';
import { createSky } from './view/sky.ts';
import { createWater } from './view/water.ts';
import { PaintTexture } from './view/paintlayer.ts';
import { createDyeUniforms } from './view/surfaces.ts';
import { loadMapView } from './view/mapview.ts';
import { loadHeroAssets, HeroView } from './view/heroview.ts';
import { Hud, applyTeamCssVars } from './ui/hud.ts';
import { BootUI } from './ui/boot.ts';
import { Input } from './input.ts';
import { Game, type AppStatus } from './game.ts';
import { installTestSurface } from './testsurface.ts';

export const VERSION = 'dyefield-0.2.0-phase2';

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

    const canvas = document.getElementById('game') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('#game canvas missing from index.html');
    const uiRoot = document.getElementById('ui') ?? document.body;

    const prog = { rapier: 0, geo: 0, atlas: 0, map: 0, hero: 0, warm: 0 };
    const report = (status?: string): void => {
      const f = prog.rapier * 0.08 + prog.geo * 0.17 + prog.atlas * 0.2 + prog.map * 0.25 + prog.hero * 0.2 + prog.warm * 0.1;
      bootUi.progress(f, status);
    };
    report('Loading Pier 18…');

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
    // keep the other promises from reporting as unhandled while we await one of them
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
    // foam lace where the sea meets the pier footprint (maps.json bounds; optional LOOK extra)
    const bb = def.bounds;
    const water = createWater(scene, preset, def.waterY ?? -1.4, sky.sunDir,
      bb ? { foamRect: [bb.min[0], bb.min[2], bb.max[0], bb.max[2]] } : {});
    renderer.toneMappingExposure = preset.exposure ?? 1;
    report('Loading the tide-runner…');

    const R = await rapierP;
    const physics = new PhysicsWorld(R, geo);
    const body = physics.createCharacter(MOVE.radius, MOVE.halfHeight);
    const spawn = geo.spawns.A;
    const player = new Player(1, body, spawn, { killY: def.killY ?? -1 });

    const heroAssets = await heroP;
    const hero = new HeroView(heroAssets, 1);
    scene.add(hero.root);
    hero.setPose(player.x, player.y - MOVE.skin, player.z, player.yaw);

    cam.reset(spawn.yaw);
    cam.update(0, player, physics);
    const input = new Input(canvas);
    const hud = new Hud(uiRoot, { team: 1, minimap });

    const game = new Game({
      app, def, canvas, rig, scene, cam, sky, water, map, geo, atlas, painter, minimap, paint, dye, physics, player, hero, hud, boot: bootUi, input,
    }, { quality });
    app.game = game;

    // shader pre-warm (doctrine §3): compile every program before frame 1, then one real frame
    // (which also builds the shadow-depth programs) behind the loading card
    report('Compiling shaders…');
    try { await renderer.compileAsync(scene, cam.camera); } catch (e) { console.warn('[dyefield] compileAsync:', e); }
    game.render(0, 1);
    await nextFrame();
    game.render(0, 1);
    prog.warm = 1;
    report('Ready');

    console.info(`[dyefield] ${VERSION} map ${def.id}: atlas ${atlas.size}² · ${atlas.count} texels · overlaps ${atlas.overlaps} · built in ${atlasMs.toFixed(0)} ms; `
      + `map ${map.triangles} tris (${map.paintTriangles} paint); static meshes ${map.merge.before} → ${map.merge.after} `
      + `(${map.merge.sources} merged into ${map.merge.merged}; casters ${map.merge.castersBefore} → ${map.merge.castersAfter}); `
      + `physics ${physics.triangles} tris; hero ${Math.round(heroAssets.tris)} tris; quality ${quality}; gpu ${rig.gpu()}`);
    for (const w of [...map.warnings, ...heroAssets.warnings]) console.warn('[dyefield]', w);

    app.phase = 'ready';
    bootUi.showPlay(() => game.requestPlay());
    game.run();
  } catch (e) {
    fail('DYEFIELD could not start', e);
  }
}

boot();
