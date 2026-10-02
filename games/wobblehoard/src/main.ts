// WOBBLEHOARD entry: compose the real modules, show the title card, then the play screen.
// The three lanes' modules are imported dynamically so the title card shows at once and a missing/broken module becomes a
// friendly error card instead of a blank page.
import './ui/styles.css';
import { installTheme } from './ui/theme.ts';
import { createApp } from './app.ts';
import type { App } from './app.ts';
import type { QualityTier, Settings } from './contracts.ts';
import { genomeFromParam } from './core/genome.ts';
import { detectEnv } from './core/settings.ts';
import { attachKeyboard } from './input/keyboard.ts';
import { attachLifecycle } from './input/lifecycle.ts';
import { attachPointerInput } from './input/pointer.ts';
import { createDevOverlay } from './ui/devOverlay.ts';
import { h } from './ui/dom.ts';
import { showErrorCard, webgl2Available } from './ui/errorCard.ts';
import { createHud } from './ui/hud.ts';
import { createLabPanel } from './ui/labPanel.ts';
import { createSettingsPanel } from './ui/settingsPanel.ts';
import type { SettingsPanel } from './ui/settingsPanel.ts';
import { createTitleCard } from './ui/titleCard.ts';

declare global { interface Window { __whBooted?: boolean } }

installTheme(); // tokens first: styles.css only reads var(--wh-*)

const QUALITIES = ['auto', 'low', 'med', 'high'] as const;

interface UrlConfig {
  genomeParam: string | null;
  overrides: Partial<Settings>;
  muted: boolean;
  dev: boolean;
  lab: boolean;
}

function readUrl(search: string): UrlConfig {
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
  showErrorCard(root, { title, message, detail });
  document.body.dataset.phase = 'error';
}

async function boot(): Promise<void> {
  const root = document.getElementById('ui');
  const canvas = document.getElementById('stage');
  if (!root || !(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #stage / #ui');
  document.getElementById('boot')?.remove();
  document.body.dataset.phase = 'boot';
  const cfg = readUrl(location.search);

  if (!webgl2Available()) {
    fail(root, 'This device can’t draw the squishy', 'WOBBLEHOARD needs WebGL2 for its 3D jelly. Try a recent Chrome, Safari, Firefox or Edge, and make sure hardware acceleration is switched on.');
    window.__whBooted = true;
    return;
  }

  const env = detectEnv();
  let app: App | null = null;
  const card = createTitleCard(root, {
    onStart() {
      // This handler IS the user gesture: unlock audio synchronously, before anything else.
      if (!app) return;
      app.unlockAudio();
      app.setPhase('play');
    },
  });
  document.body.dataset.phase = 'title';

  try {
    const [{ SoftBody }, { createStage }, { createAudio }] = await Promise.all([
      import('./physics/softbody.ts'),
      import('./render/stage.ts'),
      import('./audio/engine.ts'),
    ]);
    app = createApp({
      canvas,
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
    card.dismiss();
    fail(root, 'The squishy didn’t wake up', 'Something went wrong while starting the game. Reloading usually fixes it.', err);
    window.__whBooted = true;
    return;
  }
  const a: App = app;

  // ---- canvas size
  const resize = (): void => { a.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, Math.min(window.devicePixelRatio || 1, 3)); };
  resize();
  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);

  // ---- HUD, settings, lab, dev overlay
  let panel: SettingsPanel | null = null;
  const hud = createHud(root, { name: a.name, muted: a.muted, onGear: () => panel?.toggle(), onMute: () => a.toggleMute() });
  panel = createSettingsPanel(root, {
    settings: a.settings,
    hapticsSupported: env.vibrate,
    onChange: (k, v) => a.setSetting(k, v),
    onOpenChange: (open) => { hud.setGearOpen(open); document.body.dataset.settings = open ? 'open' : 'closed'; },
    returnFocusTo: hud.gear,
  });
  a.onSettings((s) => panel?.sync(s));
  a.onMute((m) => hud.setMuted(m));
  a.onGenome((_g, n) => hud.setName(n));
  a.onInteraction(() => hud.interact());
  a.onPhase((p) => {
    document.body.dataset.phase = p;
    if (p === 'play') { hud.setActive(true); card.dismiss(); }
  });
  if (cfg.lab && (cfg.dev || isLocalHost())) createLabPanel(root, a);
  if (cfg.dev) { createDevOverlay(root, a); window.__WH__ = a.debug; }

  // ---- input + lifecycle
  attachPointerInput(canvas, a);
  attachKeyboard(window, a, { onEscape: () => { if (panel?.isOpen()) { panel.close(); return true; } return false; } });
  attachLifecycle(a);

  // ---- WebGL context loss (mobile browsers reclaim contexts): pause, tell the player, resume when it comes back
  let lostToast: HTMLElement | null = null;
  let lostTimer = 0;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    a.pause();
    lostToast?.remove();
    lostToast = h('div', { class: 'toast', text: 'The picture was interrupted. Hang on…', attrs: { role: 'status' } });
    root.append(lostToast);
    lostTimer = window.setTimeout(() => fail(root, 'The picture didn’t come back', 'Your device took the graphics away and hasn’t returned them. Reloading will bring the squishy back.'), 5000);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    clearTimeout(lostTimer);
    lostToast?.remove();
    lostToast = null;
    a.resume();
  });

  a.setPhase('title');
  a.start();
  card.setReady(true);
  window.__whBooted = true;
}

boot().catch((err) => {
  const root = document.getElementById('ui') ?? document.body;
  fail(root, 'Something went wrong', 'The game could not start. Reloading usually fixes it.', err);
  window.__whBooted = true;
});
