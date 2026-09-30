// HIT PARADE - the app shell entry (CONTRACT §3, §12, §16; dyefield main.ts boot order, lane SHELL).
//
// Boot: params -> WebGL2 check -> loading card (BootUI adopts index.html's static card, __HP_BOOT__.handoff()) ->
// data (core/data.ts loadGameData, bundled JSON) -> renderer (view/renderer.ts) -> assets / audio / showcase ->
// menus (ui/menus.ts) -> the Game (game.ts) -> the title screen, or a deep-linked bout / season / online room.
// Any failure lands on the error card with the message (never a blank canvas); a lost WebGL context pauses and says
// "Graphics were reset by the device" with RELOAD (a restored context reloads the page).
//
// Deep links (harnesses, share links; any of these keys skips the title):
//   ?mode=versus|training|arcade|brawl|heckler|online  ?p1=<fighter> ?p2=<fighter> ?stage=<stage> ?seed=<uint>
//   ?cpu1=<-1..8> ?cpu2=<-1..8> (absent = human; training: absent = the dummy, n = DUMMY: CPU at level n)
//   ?scheme1=0|1|simple|classic ?scheme2=... ?autostart=1 (no PRESS START card) ?room=<CODE> (join an online room)
// Modifiers: ?dev=1 (the __HP__.dev surface) · ?touch=1|0 (pins the input method) · ?quality=low|med|high (this page
// only, never saved) · ?relay=1 (online: force the relay tier; read by net/online.ts).
// Example: /?mode=versus&p1=johnny&p2=bruno&stage=rust_theater&seed=1&cpu2=3&autostart=1&dev=1
//
// One GameAudio per page (unlocked by the first gesture), one Renderer, one Game; VERSION is the live fingerprint the
// deploy check greps for in the built JS.

/// <reference types="vite/client" />

import { loadGameData } from './core/data.ts';
import type { GameData } from './core/types.ts';
import type { MatchCfg } from './core/sim/match.ts';
import { Renderer, hasWebGL2, type Quality } from './view/renderer.ts';
import { Assets } from './view/assets.ts';
import { Showcase } from './view/showcase.ts';
import { Menus } from './ui/menus.ts';
import { createAudio, type GameAudio } from './audio/index.ts';
import { Game } from './game.ts';
import { BootUI, RotateOverlay, guardKeptCard } from './ui/boot.ts';
import { SettingsStore, type Settings } from './ui/settings.ts';
import { SaveStore } from './ui/save.ts';
import { Input } from './input.ts';
import { Flow } from './app/flow.ts';
import { installTestSurface } from './testsurface.ts';
import { TouchControls } from './touch/controls.ts';
import { PortraitQueue } from './app/portraits.ts';

export const VERSION = 'hit-parade-0.2.0';   // CHANGED(integrator) P2: 12 fighters, 5 stages, bonus rounds, training, online

const params = new URLSearchParams(location.search);
export const DEEP_KEYS = ['mode', 'p1', 'p2', 'stage', 'seed', 'cpu1', 'cpu2', 'scheme1', 'scheme2', 'autostart', 'room'] as const;
const DEEP_LINK = DEEP_KEYS.some((k) => params.has(k));
const DEV = params.get('dev') === '1';
const MODES = ['versus', 'training', 'arcade', 'brawl', 'heckler', 'online'] as const;
type DeepMode = typeof MODES[number];

function deepMode(): DeepMode {
  const m = (params.get('mode') || '').trim().toLowerCase();
  if ((MODES as readonly string[]).includes(m)) return m as DeepMode;
  return params.has('room') ? 'online' : 'versus';
}

const intParam = (k: string, lo: number, hi: number, d: number): number => {
  const v = params.get(k);
  if (v === null || v.trim() === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d;
};
const schemeParam = (k: string): 0 | 1 => {
  const v = (params.get(k) || '').toLowerCase();
  return v === '1' || v === 'classic' ? 1 : 0;
};

function firstStage(data: GameData): string {
  const s = data.stages as unknown;
  if (Array.isArray(s)) { const x = s[0] as { id?: string } | undefined; if (x?.id) return x.id; }
  if (s && typeof s === 'object') {
    const o = s as Record<string, unknown>;
    if (Array.isArray(o.stages)) { const x = o.stages[0] as { id?: string } | undefined; if (x?.id) return x.id; }
    const k = Object.keys(o).find((key) => key !== 'stages' && !key.startsWith('$') && key !== 'version');
    if (k) return k;
  }
  return 'rust_theater';
}

/** the deep-link bout (?p1 ?p2 ?stage ?seed ?cpuN ?schemeN); unknown fighters fall back with a console note */
function paramCfg(data: GameData, mode: MatchCfg['mode']): MatchCfg {
  const ids = Object.keys(data.fighters);
  const pick = (k: string, dflt: string): string => {
    const q = (params.get(k) || '').trim().toLowerCase();
    if (q && data.fighters[q]) return q;
    if (q) console.info(`[hit-parade] ?${k}=${q} is not a fighter in data/fighters (${ids.join(', ')}) - using ${dflt}`);
    return dflt;
  };
  const p1 = pick('p1', ids.includes('johnny') ? 'johnny' : ids[0]);
  const p2 = pick('p2', ids.includes('bruno') ? 'bruno' : (ids.find((i) => i !== p1) ?? p1));
  const home = data.fighters[p2]?.stage;
  const stage = params.get('stage') || (typeof home === 'string' && home ? home : firstStage(data));
  const seed = params.has('seed') ? (intParam('seed', 0, 0x7fffffff, 1) >>> 0) : ((Math.random() * 0x7fffffff) >>> 0);
  const training = mode === 'training';
  return {
    mode, stage, seed,
    p: [
      { fighter: p1, color: 0, scheme: schemeParam('scheme1'), cpu: intParam('cpu1', -1, 8, -1) },
      // CHANGED(integrator) P2: training P2 defaults to -1 = the TrainingDriver's dummy (UI §27.1: the menus send -1 too;
      // ?cpu2=n >= 0 starts the driver in DUMMY: CPU at level n). P1: 0 = a CPU at level 0 stood in for the dummy.
      { fighter: p2, color: p2 === p1 ? 1 : 0, scheme: schemeParam('scheme2'), cpu: intParam('cpu2', -1, 8, -1) },
    ],
    ...(training ? { timer: 0 } : {}),
  };
}

async function boot(): Promise<void> {
  window.__HP_MAIN__ = true;
  const flow = new Flow();
  const save = new SaveStore();
  const settings = new SettingsStore(save);
  const bootUi = new BootUI();
  bootUi.setMode(DEEP_LINK ? deepMode() : null);
  window.__HP_BOOT__?.handoff();
  if (guardKeptCard()) {
    // the stylesheet failed: the guard's card stays (its automatic retry / RELOAD is the way on)
    flow.fail('stylesheet failed to load (boot guard card kept)');
    return;
  }

  const c0 = settings.get().controls;
  const input = new Input({ keys: [c0[0].keys, c0[1].keys], pads: [c0[0].pad, c0[1].pad] });
  let game: Game | null = null;
  let menusUi: Menus | null = null;
  let touchUi: TouchControls | null = null;
  let renderer: Renderer | null = null;
  let audio: GameAudio | null = null;
  let contextLost = false;
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui') ?? document.body;

  installTestSurface({
    version: VERSION, dev: DEV, flow,
    loop: () => game?.loop ?? null, input: () => input, settings: () => settings, save: () => save,
    match: () => game?.matchInfo() ?? null,
    fighters: () => game?.fighters() ?? null,
    events: (n) => game?.events(n) ?? [],
    extra: () => ({
      bout: !!game?.bout, frozen: game?.frozen ?? false, gameFps: game ? Math.round(game.fps * 10) / 10 : 0,
      matchPhase: game?.bout ? (game.matchInfo()?.phase ?? null) : null,
      season: game?.season ? { index: game.season.index, slots: game.season.slots.length, continues: game.season.continues } : null,
      // CHANGED(integrator) P2: the TRAINING driver's read-back (dummy mode, guard / record / reset counters, last readout)
      trainer: game?.bout?.trainer ? game.bout.trainer.readback() : null,
      // CHANGED(fixer) D4: camera read-back (look height, the HUD safe line, each fighter's top on screen)
      cam: game?.bout ? game.bout.view.camReadback() : null,
      contextLost,
    }),
    canvas: () => canvas,
    render: () => { game?.bout?.view.render(); },
    renderInfo: () => renderer?.info() ?? null,
    audio: () => audio?.stats() ?? null,
    net: () => game?.bout?.session?.stats() ?? game?.online?.netStats() ?? null,
    touch: () => ({ mode: input.mode, pinned: input.pinned, touch: { ...input.touch }, htmlClass: document.documentElement.className,
      fullscreen: !!document.fullscreenElement }),
    startMatch: (cfg) => { if (!game) throw new Error('game not ready'); return game.devStart(cfg); },
    step: (n) => (game ? game.stepFrames(n) : 0),
    setHp: (p, v) => { if (!game) throw new Error('game not ready'); game.devWrite(p, 'hp', v); },
    setMeter: (p, k, v) => {
      if (!game) throw new Error('game not ready');
      if (k !== 'showtime' && k !== 'nerve') throw new Error(`setMeter: k must be 'showtime' or 'nerve' (got ${k})`);
      game.devWrite(p, k, v);
    },
    freeze: (on) => { game?.setFrozen(on); },
    goto: (screen) => { if (!game) throw new Error('game not ready'); game.toMenus(screen as Parameters<Game['toMenus']>[0]); },
    cpu: (p, level) => { if (!game) throw new Error('game not ready'); game.setCpu(p, level); },
    // CHANGED(integrator): UI §22.7 read-backs for menus.py / layoutcheck.py / mobile.py --game
    menus: () => menusUi?.readback() ?? null,
    hud: () => game?.hud.readback() ?? null,
    touchUi: () => touchUi?.readback() ?? null,
    touchWord: () => { if (!touchUi) throw new Error('touch overlay not ready'); return touchUi.readWord(); },
  });

  const fail = (title: string, e: unknown): void => {
    const msg = e instanceof Error ? (e.stack || e.message) : String(e);
    flow.fail(msg);
    bootUi.error(title, msg);
    console.error('[hit-parade]', title, e);
  };
  window.addEventListener('error', (ev) => {
    if (flow.phase === 'boot' || flow.phase === 'loading') fail('HIT PARADE could not start', ev.error ?? ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    if (flow.phase === 'boot' || flow.phase === 'loading') fail('HIT PARADE could not start', ev.reason);
  });

  try {
    flow.go('loading', 'boot');
    if (!hasWebGL2()) {
      fail('WebGL 2 is required', 'This browser (or its current settings) does not offer WebGL 2.\n'
        + 'Use an up-to-date Chrome, Edge, Firefox or Safari with hardware acceleration switched on, then reload.');
      return;
    }
    if (!canvas) throw new Error('#game canvas missing from index.html');
    bootUi.progress(0.1, 'Loading the show...');
    const data = loadGameData();
    bootUi.useStrings(data.strings);
    bootUi.progress(0.3, 'Setting up the cameras...');

    // ?quality= overrides the saved setting for this page only (a harness / share link never rewrites the settings)
    const qp = params.get('quality');
    const qOverride: Quality | null = qp === 'low' || qp === 'med' || qp === 'high' ? qp : null;
    const r = new Renderer(canvas, { quality: qOverride ?? settings.get().quality, touch: input.mode === 'touch' });
    renderer = r;
    // CONTRACT_MOBILE M4: a lost context pauses and says so; a restored one reloads
    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      if (contextLost) return;
      contextLost = true;
      game?.pause('context lost');
      input.live = false;
      input.releaseAll();
      flow.fail('webglcontextlost');
      bootUi.error('Graphics were reset by the device', 'The device reset the game\'s graphics (the WebGL context was lost).\nPress RELOAD to continue.');
      console.warn('[hit-parade] webglcontextlost: the graphics context was lost');
    }, false);
    canvas.addEventListener('webglcontextrestored', () => { location.reload(); }, false);
    window.addEventListener('resize', () => { try { r.resize(); } catch { /* context lost */ } });

    const assets = new Assets();
    const au = createAudio();
    audio = au;
    au.setVolumes(settings.get().volume);
    // one gesture unlocks the AudioContext (iOS: touchend / click only)
    const unlock = (): void => { void au.unlock(); };
    for (const t of ['pointerdown', 'keydown', 'touchend', 'click'] as const) window.addEventListener(t, unlock, { capture: true, passive: true });
    bootUi.progress(0.5, 'Warming up the crowd...');
    const showcase = new Showcase(r, assets, data);
    // CHANGED(integrator): portraits (UI §22.3) rendered by the Showcase; the select screen's hovered fighter jumps the queue
    let portraits: PortraitQueue | null = null;
    const showcaseDep = {
      show: (id: string, color: number, pose: 'idle' | 'intro' | 'win'): Promise<void> => { portraits?.need(id); return showcase.show(id, color, pose); },
      frame: (dt: number): void => showcase.frame(dt),
      render: (): void => showcase.render(),
      setRect: (rc: { x: number; y: number; w: number; h: number } | null): void => showcase.setRect(rc),
      hide: (): void => showcase.hide(),
    };
    const menus = new Menus(uiRoot, data, { showcase: showcaseDep, settings, save, audio: au, input });
    portraits = new PortraitQueue(showcase, (map) => menus.setPortraits(map));
    portraits.allowed = () => flow.phase !== 'bout' && flow.phase !== 'loading' && flow.phase !== 'ready';
    // CHANGED(integrator): the touch overlay (lane UI) writes input.touch (CONTRACT §18.5); game.ts shows it in bouts
    const s0 = settings.get();
    const touch = new TouchControls(uiRoot, input.touch, { scale: s0.touchScale, opacity: s0.touchOpacity, leftHanded: s0.touchLeftHanded,
      haptics: s0.haptics, layout: s0.touchLayout });
    touchUi = touch;
    const g = new Game({ data, renderer: r, assets, audio: au, menus, hudRoot: uiRoot, input, settings, save, boot: bootUi, flow, version: VERSION, dev: DEV, touch, portraits });
    game = g;
    menusUi = menus;
    touch.onPause(() => { g.pause('touch', 0); });
    touch.onLayout((l) => { settings.set({ touchLayout: Object.keys(l).length ? l : null }); });

    // the fps chip (SETTINGS show FPS); inline styles: it never depends on a stylesheet
    const fpsEl = document.createElement('div');
    fpsEl.className = 'hp-fps';
    fpsEl.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:50;padding:2px 8px;font:700 12px/1.4 Consolas,monospace;'
      + 'color:#fff4e0;background:rgba(20,13,31,.7);pointer-events:none';
    fpsEl.hidden = true;
    uiRoot.append(fpsEl);
    window.setInterval(() => { if (!fpsEl.hidden) fpsEl.textContent = `${Math.round(g.fps)} FPS`; }, 500);

    // settings -> live
    const apply = (s: Readonly<Settings>, keys: ReadonlyArray<keyof Settings>): void => {
      const all = keys.length === 0;
      const has = (k: keyof Settings): boolean => all || keys.includes(k);
      if (has('controls')) {
        input.setBindings(0, s.controls[0].keys, s.controls[0].pad);
        input.setBindings(1, s.controls[1].keys, s.controls[1].pad);
      }
      if (has('volume')) au.setVolumes(s.volume);
      if (has('quality') && !all && !qOverride) r.setQuality(s.quality);
      if (has('showFps')) fpsEl.hidden = !s.showFps;
      if (has('touchScale') || has('touchOpacity') || has('touchLeftHanded') || has('haptics') || (has('touchLayout') && !all)) {
        touch.setOptions({ scale: s.touchScale, opacity: s.touchOpacity, leftHanded: s.touchLeftHanded, haptics: s.haptics, layout: s.touchLayout });
      }
    };
    settings.on(apply);
    apply(settings.get(), []);

    // CONTRACT_MOBILE M1 / M4: a hybrid device switched input method; portrait on touch pauses a live bout
    const applyMode = (m: 'kbm' | 'touch'): void => { bootUi.setTouch(m === 'touch'); menus.setTouchMode(m === 'touch'); g.hud.setTouchMode(m === 'touch'); };
    input.onMode(applyMode);
    applyMode(input.mode);
    new RotateOverlay((shown) => { if (shown) g.pause('rotate'); });

    g.start();
    if (contextLost) return;
    bootUi.progress(0.8, 'Ready');
    if (DEEP_LINK) {
      const mode = deepMode();
      const room = params.get('room');
      if (mode === 'online' || room) {
        g.toMenus('online');
        if (room) await g.intent({ kind: 'online', action: 'join', code: room });
      } else if (mode === 'arcade') {
        const cfg = paramCfg(data, 'arcade');
        await g.startSeason({ kind: 'startSeason', fighter: cfg.p[0].fighter, color: 0, scheme: cfg.p[0].scheme, length: 'season', difficulty: 1 });
      } else {
        await g.startBout(paramCfg(data, mode), { autostart: params.get('autostart') === '1' });
      }
    } else {
      g.toMenus('title');
    }
    // the whole roster's portraits, in the background (waits while a bout loads / steps)
    window.setTimeout(() => { portraits?.all(Object.keys(data.fighters)); }, 1500);
  } catch (e) {
    if (contextLost) return;          // a load that failed on the lost context keeps the reset card
    fail('HIT PARADE could not start', e);
  }
}

void boot();
