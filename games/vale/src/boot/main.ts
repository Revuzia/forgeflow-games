// VALE — client entry (CONTRACT §3.5). Load the catalog from the runtime-configured URL, create the
// Session (LocalSession), attach the optional AUDIO and RENDER lanes when their modules exist, and
// mount ui/App over the canvas. Lane UI edited this file minimally to mount the app (TOOLS stub →
// boot); LEAD owns it.
//   ?dev=1      dev build switches: window.__vale for the harness, dev time scale in the session.
//   ?render=0   skip the renderer (the UI draws its own backdrop).
// DEV AUTOPILOT (fast verification; all need ?dev=1):
//   ?autopilot=1 | draft | match   your seat is drafted and/or played by the bot brains
//   ?speed=N                        every match runs at time scale N (1–16) once it starts
//   ?autoflow=1                     accept ready checks by itself (the rest of the flow stays yours)

import { loadCatalog } from './catalog.ts';
import { LocalSession } from '../session/index.ts';
import { mount, mountBootError, mountLoading } from '../ui/app.tsx';
import type { AudioPort } from '../ui/audio_port.ts';

const ui = document.getElementById('ui')!;
const query = new URLSearchParams(location.search);
const dev = query.get('dev') === '1';
/** ?render=0: run the client without the 3D renderer (UI review on software GL, low-end fallback checks) */
const noRender = query.get('render') === '0';
const ap = query.get('autopilot');
const autopilot = !dev || !ap ? undefined : ap === 'draft' || ap === 'match' ? ap : ap === '1' || ap === 'true' ? true : undefined;
const speed = dev ? Math.max(1, Math.min(16, Number(query.get('speed')) || 1)) : 1;
const autoflow = dev && query.get('autoflow') === '1';

// optional lanes, loaded only when present (AUDIO: src/audio/index.ts → createAudioEngine;
// RENDER: src/render/index.ts → createRenderer, CONTRACT §9). Missing modules are simply skipped.
type AudioModule = { createAudioEngine?: (o: { catalog: unknown; assetUrl: (ref: string) => string; settings: unknown }) => AudioPort | Promise<AudioPort> };
const audioLoaders = import.meta.glob<AudioModule>('../audio/index.ts');
type RenderModule = { createRenderer?: (canvas: HTMLCanvasElement, catalog: never, settings: never, assetUrl: (ref: string) => string, o?: { dev?: boolean }) => unknown };
const renderLoaders = import.meta.glob<RenderModule>('../render/index.ts');

mountLoading(ui);
loadCatalog().then(
  async (c) => {
    console.info(`[vale] catalog ${c.version} (schema ${c.schema}) from ${c.manifestUrl}`);
    const session = new LocalSession({ catalog: c.catalog, dev, ...(autopilot !== undefined ? { autopilot } : {}) });
    if (speed > 1 || autoflow) {
      session.on((e) => {
        if (e.type === 'match' && speed > 1) e.client.setTimeScale(speed);
        if (e.type === 'queue' && e.state === 'found' && autoflow) setTimeout(() => { try { session.acceptMatch(); } catch { /* already accepted */ } }, 400);
      });
    }
    if (autopilot !== undefined || speed > 1 || autoflow) console.info(`[vale] dev autopilot: ${JSON.stringify({ autopilot, speed, autoflow })}`);
    let audio: AudioPort | null = null;
    const loadAudio = Object.values(audioLoaders)[0];
    if (loadAudio) {
      try { audio = (await (await loadAudio()).createAudioEngine?.({ catalog: c.catalog, assetUrl: c.assetUrl, settings: session.profile().settings })) ?? null; }
      catch (e) { console.warn('[vale] audio engine unavailable', e); }
    }
    let renderer: Parameters<typeof mount>[1]['renderer'] = null;
    const loadRender = Object.values(renderLoaders)[0];
    const canvas = document.getElementById('view') as HTMLCanvasElement | null;
    if (loadRender && canvas && !noRender) {
      try { renderer = ((await loadRender()).createRenderer?.(canvas, c.catalog as never, session.profile().settings as never, c.assetUrl, { dev }) ?? null) as typeof renderer; }
      catch (e) { console.warn('[vale] renderer unavailable', e); }
    }
    mount(ui, { catalog: c.catalog, session, audio, renderer, assetUrl: c.assetUrl, dev });
  },
  (e: unknown) => {
    console.error('[vale] catalog load failed', e);
    mountBootError(ui, e instanceof Error ? e.message : String(e));
  },
);
