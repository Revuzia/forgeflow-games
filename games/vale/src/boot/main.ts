// VALE — client entry (CONTRACT §3.5). Load the catalog from the runtime-configured URL, create the
// Session (LocalSession), attach the optional AUDIO and RENDER lanes when their modules exist, and
// mount ui/App over the canvas. Lane UI edited this file minimally to mount the app (TOOLS stub →
// boot); LEAD owns it.
//   ?dev=1      dev build switches: window.__vale for the harness, dev time scale in the session.
//   ?render=0   skip the renderer (the UI draws its own backdrop).

import { loadCatalog } from './catalog.ts';
import { LocalSession } from '../session/index.ts';
import { mount, mountBootError, mountLoading } from '../ui/app.tsx';
import type { AudioPort } from '../ui/audio_port.ts';

const ui = document.getElementById('ui')!;
const query = new URLSearchParams(location.search);
const dev = query.get('dev') === '1';
/** ?render=0: run the client without the 3D renderer (UI review on software GL, low-end fallback checks) */
const noRender = query.get('render') === '0';

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
    const session = new LocalSession({ catalog: c.catalog, dev });
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
