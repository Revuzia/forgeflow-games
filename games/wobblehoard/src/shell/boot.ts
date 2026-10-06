// Boot and teardown: the DOM around the game core. Title card first (it is also the audio-unlock gesture), the three lanes' modules
// imported dynamically (so the title shows at once and a broken module becomes a friendly card, never a blank page), then the HUD,
// the settings panel, the squishy's keyboard target, the live region, input and lifecycle, and WebGL context loss.
//
// DEV ONLY (import.meta.env.DEV, so `vite build` drops the import and the module): ?dev=1 exposes window.__WH__ (debugHook.ts) and the
// stats overlay; ?lab=1 adds the sound lab. A production build contains no hook, no lab and no /__shot poster (audit findings 6 / 20).
import type { QualityTier, Settings } from '../contracts.ts';
import { genomeFromParam } from '../core/genome.ts';
import { SETTINGS_KEY, detectEnv, parseSettingsText, safeLocalStorage } from '../core/settings.ts';
import type { StorageSubscribe } from '../core/save.ts';
import { createProfileStore } from '../core/save.ts';
import { createCollection } from '../collection/index.ts';
import { mulberry32 } from '../core/rng.ts';
import { attachKeyboard } from '../input/keyboard.ts';
import { attachLifecycle } from '../input/lifecycle.ts';
import { attachPointerInput } from '../input/pointer.ts';
import { h } from '../ui/dom.ts';
import { showErrorCard, webgl2Available } from '../ui/errorCard.ts';
import { createTitleCard } from '../ui/titleCard.ts';
import type { Game } from './game.ts';
import { createGame } from './game.ts';
import { bindUi } from './hudBinding.ts';

declare global { interface Window { __whBooted?: boolean } }

const QUALITIES = ['auto', 'low', 'med', 'high'] as const;
/** WebGL context loss: how long to wait for the context to come back before the give-up card */
export const CONTEXT_GIVE_UP_MS = 5000;

interface UrlConfig { genomeParam: string | null; overrides: Partial<Settings>; muted: boolean; dev: boolean; lab: boolean }

export function readUrl(search: string): UrlConfig {
  const p = new URLSearchParams(search);
  const overrides: Partial<Settings> = {};
  if (p.get('float') === '1') overrides.gravity = false;
  const q = p.get('quality');
  if (q && (QUALITIES as readonly string[]).includes(q)) overrides.quality = q as QualityTier | 'auto';
  return { genomeParam: p.get('genome'), overrides, muted: p.get('mute') === '1', dev: p.get('dev') === '1', lab: p.get('lab') === '1' };
}

const isLocalHost = (): boolean => /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);

function fail(root: HTMLElement, title: string, message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err ? String(err) : undefined;
  if (err) console.error(err);
  root.querySelector('.title')?.remove();
  root.querySelector('.hud')?.setAttribute('inert', '');
  root.querySelector('.panel')?.setAttribute('inert', '');
  root.querySelector('.play-target')?.setAttribute('inert', '');
  showErrorCard(root, { title, message, detail });
  document.body.dataset.phase = 'error';
}


export async function boot(): Promise<(() => void) | null> {
  const root = document.getElementById('ui');
  const canvas = document.getElementById('stage');
  if (!root || !(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #stage / #ui');
  document.getElementById('boot')?.remove();
  document.body.dataset.phase = 'boot';
  const cfg = readUrl(location.search);

  if (!webgl2Available()) {
    fail(root, 'This device can’t draw the squishy', 'Squish Keeper needs WebGL2 for its 3D jelly. Try a recent Chrome, Safari, Firefox or Edge, and make sure hardware acceleration is switched on.');
    window.__whBooted = true;
    return null;
  }

  const env = detectEnv();
  // storage, the profile and the collection share ONE cross-tab subscription (window 'storage'); the profile first, so the collection's
  // starter ghost keeps the profile's starter id (src/collection/index.ts WIRING)
  const storage = safeLocalStorage();
  const subscribe: StorageSubscribe = (fn) => { const h = (e: StorageEvent): void => fn(e.key); window.addEventListener('storage', h); return () => window.removeEventListener('storage', h); };
  // DEV ONLY: a clock skew the dev meter accelerator pushes ahead (debugHook.ts); production reads the plain epoch clock
  const skew = { ms: 0 };
  const epochNow = import.meta.env.DEV ? () => Date.now() + skew.ms : () => Date.now();
  let game: Game | null = null;
  let playTargetFocus: (() => void) | null = null;
  const card = createTitleCard(root, {
    onStart(viaKeyboard) {
      // This handler IS the user gesture: unlock audio synchronously, before anything else.
      if (!game) return;
      game.unlockAudio();
      game.setPhase('play');
      // keyboard: focus goes to the squishy (Space pokes at once); pointer: no focus ring over the toy
      if (viaKeyboard) playTargetFocus?.(); else (document.activeElement as HTMLElement | null)?.blur?.();
    },
  });
  document.body.dataset.phase = 'title';

  let profile: ReturnType<typeof createProfileStore> | null = null;
  let hoard: ReturnType<typeof createCollection> | null = null;
  try {
    const [{ SoftBody }, { createStage }, { createAudio }] = await Promise.all([
      import('../physics/softbody.ts'),
      import('../render/stage.ts'),
      import('../audio/engine.ts'),
    ]);
    profile = createProfileStore(storage, { subscribe });
    // DEV ONLY: ?dev=1&rseed=N makes the practice rolls repeatable (the harness's scripted practice loop); a build never reads it
    const rseed = import.meta.env.DEV && cfg.dev ? Number(new URLSearchParams(location.search).get('rseed')) : NaN;
    hoard = createCollection({ storage, profile: profile.profile, subscribe, now: epochNow, random: Number.isFinite(rseed) && rseed > 0 ? mulberry32(rseed >>> 0) : undefined });
    game = createGame({
      canvas,
      storage,
      profile,
      collection: hoard,
      epochNow,
      createBody: (g) => new SoftBody(g),
      createStage,
      createAudio,
      genome: cfg.genomeParam ? genomeFromParam(cfg.genomeParam) : undefined,
      overrides: cfg.overrides,
      muted: cfg.muted,
      env,
      onFatal: (err) => fail(root, 'The squishy tripped', 'Something went wrong while drawing. Reloading usually fixes it.', err),
    });
  } catch (err) {
    // createGame already disposed what it built (stage, audio); the saves and their cross-tab listeners are ours to close
    try { hoard?.dispose(); } catch { /* ignore */ }
    try { profile?.dispose(); } catch { /* ignore */ }
    card.dismiss();
    fail(root, 'The squishy didn’t wake up', 'Something went wrong while starting the game. Reloading usually fixes it.', err);
    window.__whBooted = true;
    return null;
  }
  const g: Game = game;

  // ---- canvas size
  const resize = (): void => { g.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, Math.min(window.devicePixelRatio || 1, 3)); };
  resize();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);

  // ---- the DOM around the game (HUD, the squishy's keyboard target, settings, live region, reveal plate): hudBinding.ts
  const ui = bindUi(root, canvas, g, env, { onPlay: () => card.dismiss() });
  playTargetFocus = () => ui.play.focus();

  // ---- input + lifecycle
  const detachPointer = attachPointerInput(canvas, g);
  const detachKeys = attachKeyboard(window, g, { onEscape: () => ui.escape(), shortcutsEnabled: () => g.settings.shortcuts, onKeyUsed: () => ui.keyUsed(), onHoard: () => { if (g.phase === 'play') ui.hoard.toggle(); }, onSwitch: (dir) => { if (g.phase === 'play' && !ui.hoard.isOpen) ui.switchBy(dir); } });
  const detachLife = attachLifecycle(g);

  // another tab changed the settings: follow it (the 'storage' event fires in the OTHER tabs only)
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== SETTINGS_KEY) return;
    const st = parseSettingsText(e.newValue, env);
    if (st) g.adoptExternalSettings(st);
  };
  window.addEventListener('storage', onStorage);

  // ---- WebGL context loss (mobile browsers reclaim contexts): freeze input, stop held voices, tell the player; resume when it comes
  // back; after CONTEXT_GIVE_UP_MS a working give-up card (the loop stops, the phase is 'error', the ceremony sounds stop). Finding 1.
  let lostToast: HTMLElement | null = null;
  let lostTimer = 0;
  const onLost = (e: Event): void => {
    e.preventDefault();
    g.suspend('context');
    lostToast?.remove();
    lostToast = h('div', { class: 'toast', text: 'The picture was interrupted. Hang on…', attrs: { role: 'status' } });
    root.append(lostToast);
    clearTimeout(lostTimer);
    lostTimer = window.setTimeout(() => {
      lostToast?.remove(); lostToast = null;
      try { g.ceremonies.abort(); } catch { /* ignore */ }
      g.stop();
      g.setPhase('error');
      fail(root, 'The picture didn’t come back', 'Your device took the graphics away and hasn’t returned them. Reloading will bring the squishy back.');
    }, CONTEXT_GIVE_UP_MS);
  };
  const onRestored = (): void => {
    if (g.phase === 'error') return;   // the give-up card is up: a reload is the way back
    clearTimeout(lostTimer);
    lostToast?.remove();
    lostToast = null;
    g.unsuspend('context');
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  // ---- dev tools (never in a production bundle)
  if (import.meta.env.DEV && (cfg.dev || (cfg.lab && isLocalHost()))) {
    const [{ createDebugTools }, { createDevOverlay }, { createLabPanel }] = await Promise.all([
      import('./debugHook.ts'), import('../ui/devOverlay.ts'), import('../ui/labPanel.ts'),
    ]);
    const tools = createDebugTools(g, { skew });
    if (cfg.dev) { window.__WH__ = tools.debug; createDevOverlay(root, g); }
    if (cfg.lab) createLabPanel(root, { lab: tools.lab, unlockAudio: () => g.unlockAudio() });
  }

  g.setPhase('title');
  g.start();
  card.setReady(true);
  window.__whBooted = true;

  // teardown (a host that unmounts the game, a test): every listener off, the saves flushed, GL context and AudioContext released
  return () => {
    clearTimeout(lostTimer);
    detachPointer(); detachKeys(); detachLife();
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('resize', resize);
    window.visualViewport?.removeEventListener('resize', resize);
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    ro?.disconnect();
    ui.destroy();
    g.dispose();   // flushes and disposes the collection; disposes stage and audio
    try { profile?.flush(); profile?.dispose(); } catch { /* ignore */ }
    if (import.meta.env.DEV && window.__WH__) delete window.__WH__;
  };
}
