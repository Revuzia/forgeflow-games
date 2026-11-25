// VALE — client entry (CONTRACT §3.5). Load the catalog from the runtime-configured URL, create the
// Session (LocalSession), attach the optional AUDIO and RENDER lanes when their modules exist, and
// mount ui/App over the canvas. Lane UI edited this file minimally to mount the app (TOOLS stub →
// boot); LEAD owns it.
//   ?dev=1      dev build switches: window.__vale for the harness, dev time scale in the session.
//   ?render=0   skip the renderer (the UI draws its own backdrop).
//   ?audio=0    skip the audio lane (round 4 MEM-1: a memory A/B, probe_match_memory --no-audio, tells what a session's
//               audio holds from what the rest holds; the client runs silent, the UI's audio port is null as on failure).
// DEV AUTOPILOT (fast verification; all need ?dev=1):
//   ?autopilot=1 | draft | match   your seat is drafted and/or played by the bot brains
//   ?speed=N                        every match runs at time scale N (1–16) once it starts
//   ?autoflow=1                     accept ready checks by itself (the rest of the flow stays yours)
//   ?seed=N                         the session's rng seed, so a capture can be repeated
//   ?tabs=1 | 0                     the one-tab lock on (it is off under ?dev=1 so harness pages share a browser) | off
// SHIP GATES (W1-E): before anything loads, a browser without WebGL2, a touch-only device or a window under 1024 x 600
// gets a branded plate (device.ts; "Try anyway" for the last two); ?render=0 in a shipped build counts as no WebGL2. A
// second tab gets "VALE is open in another tab" (tabs.ts); a renderer that fails to start is a plate, never a menu
// that can queue a match that draws nothing. The store's storage state and a refused stale save arrive as toasts.

import { loadCatalog } from './catalog.ts';
import { ShipSession } from './ship_session.ts';
import { OnlineLink } from '../session/online_link.ts';
import { LocalProfileStore } from '../session/profile_store.ts';
import { mount, mountBootError, mountLoading, type MountedApp } from '../ui/app.tsx';
import type { AudioPort } from '../ui/audio_port.ts';
import { deviceProblem, readDeviceFacts, shipText } from './device.ts';
import { showDevicePlate, showTabPlate } from './gate.tsx';
import { acquireTab, stealTab, tabLocksSupported } from './tabs.ts';
import { classifyDevice, readGpuFacts } from '../render/device_tier.ts';
import { applyPreset, detectPreset } from '../session/settings.ts';
import { CALIB_KEY, calibStillValid, DEVTIER_KEY, parseTier, startPreset, type StartRecord } from './start_tier.ts';

const ui = document.getElementById('ui')!;
const query = new URLSearchParams(location.search);
// ?dev=1 (the harness handle, autopilot, time scale, autoflow) works in dev builds only: in a shipped build the
// autopilot would play matches for you at 16x and still earn Candles, XP and rating
let devBuild = false;
try { devBuild = !!import.meta.env?.DEV; } catch { devBuild = false; }
const dev = devBuild && query.get('dev') === '1';
/** ?render=0: run the client without the 3D renderer (UI review on software GL, low-end fallback checks) */
const noRender = query.get('render') === '0';
const noAudio = query.get('audio') === '0';
const ap = query.get('autopilot');
const autopilot = !dev || !ap ? undefined : ap === 'draft' || ap === 'match' ? ap : ap === '1' || ap === 'true' ? true : undefined;
const speed = dev ? Math.max(1, Math.min(16, Number(query.get('speed')) || 1)) : 1;
const autoflow = dev && query.get('autoflow') === '1';
/** ?dev=1&seed=N: the session's rng seed (draft bots, seats, match seeds), so a capture can be repeated */
const seed = dev && query.get('seed') ? Number(query.get('seed')) >>> 0 : undefined;

// optional lanes, loaded only when present (AUDIO: src/audio/index.ts → createAudioEngine;
// RENDER: src/render/index.ts → createRenderer, CONTRACT §9). Missing modules are simply skipped.
type AudioModule = { createAudioEngine?: (o: { catalog: unknown; assetUrl: (ref: string) => string; settings: unknown }) => AudioPort | Promise<AudioPort> };
const audioLoaders = import.meta.glob<AudioModule>('../audio/index.ts');
type RenderModule = { createRenderer?: (canvas: HTMLCanvasElement, catalog: never, settings: never, assetUrl: (ref: string) => string, o?: { dev?: boolean; eventVfx?: Record<string, string>; statusVfx?: Record<string, string> }) => unknown };
const renderLoaders = import.meta.glob<RenderModule>('../render/index.ts');

let mounted: MountedApp | null = null;

function start(): void {
mountLoading(ui);
loadCatalog().then(
  async (c) => {
    console.info(`[vale] catalog ${c.version} (schema ${c.schema}) from ${c.manifestUrl}`);
    // online play: ?server=wss://… or VALE_CONFIG.server (public/config.js); without one, every queue is local
    const serverUrl = query.get('server') ?? (window as unknown as { VALE_CONFIG?: { server?: string | null } }).VALE_CONFIG?.server ?? null;
    let named: ShipSession | null = null;
    const online = serverUrl ? new OnlineLink(serverUrl, c.catalog.version, () => named?.identity.displayName ?? 'Player') : null;
    const store = new LocalProfileStore();
    const session = new ShipSession({ catalog: c.catalog, dev, online, store, ...(autopilot !== undefined ? { autopilot } : {}), ...(seed !== undefined ? { seed } : {}) });
    named = session;
    applyStartTier(session);
    if (speed > 1 || autoflow) {
      session.on((e) => {
        if (e.type === 'match' && speed > 1) e.client.setTimeScale(speed);
        if (e.type === 'queue' && e.state === 'found' && autoflow) setTimeout(() => { try { session.acceptMatch(); } catch { /* already accepted */ } }, 400);
      });
    }
    if (autopilot !== undefined || speed > 1 || autoflow) console.info(`[vale] dev autopilot: ${JSON.stringify({ autopilot, speed, autoflow })}`);
    let audio: AudioPort | null = null;
    const loadAudio = Object.values(audioLoaders)[0];
    if (loadAudio && !noAudio) {
      try { audio = (await (await loadAudio()).createAudioEngine?.({ catalog: c.catalog, assetUrl: c.assetUrl, settings: session.profile().settings })) ?? null; }
      catch (e) { console.warn('[vale] audio engine unavailable', e); }
      // dev: the engine itself for the audio probes (_harness/probe_audio_*.mjs meter its output graph)
      if (dev && audio) (window as unknown as { __valeAudio?: AudioPort }).__valeAudio = audio;
    }
    let renderer: Parameters<typeof mount>[1]['renderer'] = null;
    const loadRender = Object.values(renderLoaders)[0];
    const canvas = document.getElementById('view') as HTMLCanvasElement | null;
    if (loadRender && canvas && !noRender) {
      try { renderer = ((await loadRender()).createRenderer?.(canvas, c.catalog as never, session.profile().settings as never, c.assetUrl, {
        dev, eventVfx: c.catalog.client.vfxEvents, statusVfx: c.catalog.client.vfxStatus,
      }) ?? null) as typeof renderer; }
      catch (e) { console.warn('[vale] renderer unavailable', e); }
      // a shipped build never mounts a menu that can queue a match that draws nothing (a dev build keeps the backdrop)
      if (!renderer && !dev) { showDevicePlate(ui, { kind: 'webgl', tryAnyway: false }, () => {}); return; }
    }
    // the audio listener rides the camera's ground focus (Renderer.listenerFocus), so a fight watched while dead or
    // scouting is heard where you look; with no renderer the engine hears from your fighter
    const focusOf = (renderer as { listenerFocus?: () => { x: number; y: number } } | null)?.listenerFocus;
    const ear = audio as { listener?: (f: (() => { x: number; y: number } | null) | null) => void } | null;
    if (renderer && focusOf) ear?.listener?.(() => focusOf.call(renderer));
    const app = mount(ui, { catalog: c.catalog, session, audio, renderer, assetUrl: c.assetUrl, dev });
    mounted = app;
    // storage that cannot save, and a save another tab got ahead of, are said once, in the toast stack
    store.onStatus((st) => {
      const cv = app.state.cv;
      if (st === 'degraded') app.state.toast(cv.t('state.error.storage', 'This browser is blocking saved data. Your progress will not be kept.'), 'warn', undefined, 12000);
      else app.state.toast(cv.t('ship.stale.toast', shipText('ship.stale.toast')), 'warn', { label: cv.t('ship.device.reload', 'Reload'), run: () => location.reload() }, 20000);
    });
  },
  (e: unknown) => {
    console.error('[vale] catalog load failed', e);
    mountBootError(ui, e instanceof Error ? e.message : String(e));
  },
);
}

// ── ruling 67: the device's start ceiling, before the renderer exists ─────────────────────────────
// render/device_tier.ts reads the GPU string (WEBGL_debug_renderer_info), software rendering, deviceMemory, cores; a
// profile still on the untouched High default starts at that ceiling (Intel UHD -> Low, Iris Xe / AMD integrated ->
// Medium), so no High program is compiled on a laptop that should not start there. boot/start_tier.ts decides.
const gpuFacts = readGpuFacts();
// QA: ?fakegpu=<renderer string> classifies as if the GPU said that (the Windows strings cannot be had on this Mac)
if (query.get('fakegpu')) gpuFacts.renderer = query.get('fakegpu')!;
const deviceClass = classifyDevice(gpuFacts);
const autoTier = !navigator.webdriver || query.get('calibrate') === '1';
const forcedTier = parseTier(query.get('tier'));
const SLOW_KEY = 'vale.gate.slow.v1';
const playOnLow = (): boolean => { try { return sessionStorage.getItem(SLOW_KEY) === '1'; } catch { return false; } };
const lsGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
function applyStartTier(session: ShipSession): void {
  const v = session.profile().settings.video;
  const untouchedHigh = v.preset === 'high' && detectPreset(v) === 'high';
  // the old first-run rule's under-30-frame "high" verdict is no verdict: that device is judged again (start_tier.ts)
  if (lsGet(CALIB_KEY) && !calibStillValid(lsGet(CALIB_KEY))) { try { localStorage.removeItem(CALIB_KEY); } catch { /* per-device */ } }
  // a software renderer's ceiling is already Low, so "Play on Low" needs nothing more here
  const preset = startPreset({ cls: deviceClass, forced: forcedTier, auto: autoTier, untouchedHigh, devtierDone: !!lsGet(DEVTIER_KEY) });
  if (preset) session.updateSettings({ video: applyPreset(v, preset) });
  if (preset && !forcedTier && autoTier) { try { localStorage.setItem(DEVTIER_KEY, JSON.stringify({ cap: deviceClass.cap, applied: preset, gpu: deviceClass.gpu, at: new Date().toISOString() })); } catch { /* per-device */ } }
  const rec: StartRecord = {
    cls: deviceClass, renderer: gpuFacts.renderer, vendor: gpuFacts.vendor, applied: preset, ceiling: deviceClass.cap,
    facts: { deviceMemory: gpuFacts.deviceMemory ?? null, cores: gpuFacts.cores ?? null, maxTextureSize: gpuFacts.maxTextureSize ?? null, parallelCompile: !!gpuFacts.parallelCompile, caveat: gpuFacts.caveat, auto: autoTier, forced: forcedTier },
  };
  (window as unknown as { __valeStart?: StartRecord }).__valeStart = rec;
  console.info(`[vale] device: ${deviceClass.gpu}, start ceiling ${deviceClass.cap} (${deviceClass.reasons.join('; ')})${preset ? `, start preset ${preset}` : ''} — ${gpuFacts.renderer}`);
}

// ── ship gates, then start ────────────────────────────────────────────────────────────────────────
const TRIED_KEY = 'vale.gate.try.v1';
const tried = (): boolean => { try { return sessionStorage.getItem(TRIED_KEY) === '1'; } catch { return false; } };

/** one tab owns the profile: take the lock, or offer to take it over */
function startOneTab(): void {
  const useLock = tabLocksSupported() && query.get('tabs') !== '0' && (!dev || query.get('tabs') === '1');
  if (!useLock) { start(); return; }
  const lost = (): void => { try { mounted?.unmount(); } catch { /* the plate matters more */ } showTabPlate(ui, 'moved', () => { void stealTab(() => {}).then(() => location.reload()); }); };
  void acquireTab(lost).then((mine) => {
    if (mine) { start(); return; }
    showTabPlate(ui, 'other', () => { void stealTab(lost).then(() => start()); });
  });
}

const problem = deviceProblem(readDeviceFacts(), { noRender, dev, tried: tried() });
if (!problem && deviceClass.software && autoTier && !forcedTier && !playOnLow()) {
  // ruling 67: no GPU acceleration: say so before any heavy work; "Play on Low" goes on at Low (this visit)
  showDevicePlate(ui, { kind: 'slow', tryAnyway: true }, () => {
    try { sessionStorage.setItem(SLOW_KEY, '1'); } catch { /* the preset below still applies */ }
    startOneTab();
  });
} else if (problem) {
  showDevicePlate(ui, problem, () => {
    try { sessionStorage.setItem(TRIED_KEY, '1'); } catch { /* per-visit only */ }
    startOneTab();
  });
} else startOneTab();
