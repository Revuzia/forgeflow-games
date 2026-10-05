// Boot and teardown: the DOM around the game core. Title card first (it is also the audio-unlock gesture), the three lanes' modules
// imported dynamically (so the title shows at once and a broken module becomes a friendly card, never a blank page), then the HUD,
// the settings panel, the squishy's keyboard target, the live region, input and lifecycle, and WebGL context loss.
//
// DEV ONLY (import.meta.env.DEV, so `vite build` drops the import and the module): ?dev=1 exposes window.__WH__ (debugHook.ts) and the
// stats overlay; ?lab=1 adds the sound lab. A production build contains no hook, no lab and no /__shot poster (audit findings 6 / 20).
import type { QualityTier, Settings, TierName } from '../contracts.ts';
import { genomeFromParam } from '../core/genome.ts';
import { SETTINGS_KEY, detectEnv, parseSettingsText } from '../core/settings.ts';
import { attachKeyboard } from '../input/keyboard.ts';
import { attachLifecycle } from '../input/lifecycle.ts';
import { attachPointerInput } from '../input/pointer.ts';
import { createAnnouncer } from '../ui/announcer.ts';
import { h, isCoarsePointer } from '../ui/dom.ts';
import { showErrorCard, webgl2Available } from '../ui/errorCard.ts';
import { tierLabel } from '../ui/gem.ts';
import { createHud } from '../ui/hud.ts';
import { createPlayTarget } from '../ui/playTarget.ts';
import { createRevealPlate, plateText } from '../ui/revealPlate.ts';
import { createSettingsPanel } from '../ui/settingsPanel.ts';
import type { SettingsPanel } from '../ui/settingsPanel.ts';
import { createTitleCard } from '../ui/titleCard.ts';
import type { Game, PlayLabel } from './game.ts';
import { createGame } from './game.ts';

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

const labelText = (l: PlayLabel): string => `${l.species}, ${tierLabel(l.tier)}${l.nickname ? `, called ${l.nickname}` : ''}`;

export async function boot(): Promise<void> {
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

  try {
    const [{ SoftBody }, { createStage }, { createAudio }] = await Promise.all([
      import('../physics/softbody.ts'),
      import('../render/stage.ts'),
      import('../audio/engine.ts'),
    ]);
    game = createGame({
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
  const g: Game = game;

  // ---- canvas size
  const resize = (): void => { g.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, Math.min(window.devicePixelRatio || 1, 3)); };
  resize();
  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);

  // ---- HUD, the squishy's keyboard target, settings, live region, reveal plate
  const announcer = createAnnouncer(root);
  let panel: SettingsPanel | null = null;
  const hud = createHud(root, {
    label: g.label, muted: g.muted,
    onGear: () => panel?.toggle(),
    onMute: () => g.toggleMute(),
    onOpenCapsule: () => { g.unlockAudio(); void g.capsules.openNext(); },
  });
  const play = createPlayTarget(root);
  playTargetFocus = () => play.focus();
  const setPlayLabel = (l: PlayLabel): void => {
    play.setLabel(`Squishy: ${labelText(l)}`);
    canvas.setAttribute('aria-label', `Your squishy, ${labelText(l)}: a soft translucent toy on a felt mat.`);
  };
  setPlayLabel(g.label);
  const plate = createRevealPlate(root);
  panel = createSettingsPanel(root, {
    settings: g.settings,
    hapticsSupported: env.vibrate,
    onChange: (k, v) => g.setSetting(k, v),
    onOpenChange: (open) => { hud.setGearOpen(open); document.body.dataset.settings = open ? 'open' : 'closed'; },
    returnFocusTo: hud.gear,
    escapeFocusTo: () => (g.phase === 'play' ? play.el : null),
  });
  let toast: HTMLElement | null = null;
  let toastTimer = 0;
  const showToast = (text: string, ms = 3200): void => {
    toast?.remove();
    toast = h('div', { class: 'toast', text, attrs: { 'aria-hidden': 'true' } });
    root.append(toast);
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast?.remove(); toast = null; }, ms);
  };

  // ---- game -> UI
  let gravityWas = g.settings.gravity;
  const applyCalmClass = (calm: boolean): void => { document.body.dataset.calm = String(calm); };
  applyCalmClass(g.settings.calm);
  g.on('settings', (s) => {
    panel?.sync(s);
    applyCalmClass(s.calm);
    if (s.gravity !== gravityWas) { gravityWas = s.gravity; announcer.say(s.gravity ? 'On the table' : 'Floating'); }
  });
  g.on('mute', (m) => { hud.setMuted(m); announcer.say(m ? 'Sound off' : 'Sound on'); });
  g.on('identity', (_id, l) => { hud.setLabel(l); setPlayLabel(l); if (g.ceremonies.active === false) announcer.say(`Your squishy: ${labelText(l)}`); });
  g.on('interaction', () => { hud.interact(); if (plate.shown && !g.ceremonies.active) plate.hide(); });
  g.on('meter', (m) => { hud.meter.set(m); });
  let lastState = '';
  g.on('meter', () => {
    const st = hud.meter.stateText;
    if (st && st !== lastState) announcer.say(st);
    lastState = st;
  });
  g.on('capsuleReady', (n) => { hud.meter.pulse(g.settings.calm); announcer.say(n > 1 ? `A capsule is ready. ${n} waiting.` : 'A capsule is ready.'); });
  g.on('message', (t) => { showToast(t); announcer.say(t); });
  g.on('ceremony', (e) => {
    if (e.type === 'start') { hud.meter.setBusy(true); plate.hide(); document.body.dataset.ceremony = e.kind; return; }
    const i = e.info;
    const info = { species: i.speciesName, tier: i.item.tier as TierName, isNew: i.item.isNew, copies: i.item.copies, tierUp: i.tierUp, nickname: i.item.nickname };
    if (e.type === 'reveal') { plate.show(info); announcer.say(plateText(info)); return; }
    hud.meter.setBusy(false);
    delete document.body.dataset.ceremony;
  });
  g.on('phase', (p) => {
    document.body.dataset.phase = p;
    if (p === 'play') { hud.setActive(true); card.dismiss(); }
  });
  hud.meter.set(g.capsules.reading);

  // ---- the play target follows the squishy on screen (CSSOM writes only; re-placed every frame while it has focus)
  let placeRaf = 0;
  const place = (): void => { play.place(g.host.bodyScreen()); };
  const placeLoop = (): void => { placeRaf = 0; place(); if (play.focused) placeRaf = requestAnimationFrame(placeLoop); };
  play.el.addEventListener('focus', () => { if (!placeRaf) placeRaf = requestAnimationFrame(placeLoop); });
  setInterval(place, 250);

  // ---- input + lifecycle
  attachPointerInput(canvas, g);
  attachKeyboard(window, g, {
    onEscape: () => { if (panel?.isOpen()) { panel.close('escape'); return true; } if (plate.shown) { plate.hide(); return true; } return false; },
    shortcutsEnabled: () => g.settings.shortcuts,
    onKeyUsed: () => { document.body.dataset.kbd = '1'; if (!isCoarsePointer()) hud.setHintMode('keyboard'); },
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab') document.body.dataset.kbd = '1'; }, { capture: true, passive: true });
  attachLifecycle(g);

  // another tab changed the settings: follow it (the 'storage' event fires in the OTHER tabs only)
  window.addEventListener('storage', (e) => {
    if (e.key !== SETTINGS_KEY) return;
    const s = parseSettingsText(e.newValue, env);
    if (s) g.adoptExternalSettings(s);
  });

  // ---- WebGL context loss (mobile browsers reclaim contexts): freeze input, stop held voices, tell the player; resume when it comes
  // back; after CONTEXT_GIVE_UP_MS a working give-up card (the loop stops, the phase is 'error', the ceremony sounds stop). Finding 1.
  let lostToast: HTMLElement | null = null;
  let lostTimer = 0;
  canvas.addEventListener('webglcontextlost', (e) => {
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
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (g.phase === 'error') return;   // the give-up card is up: a reload is the way back
    clearTimeout(lostTimer);
    lostToast?.remove();
    lostToast = null;
    g.unsuspend('context');
  });

  // ---- dev tools (never in a production bundle)
  if (import.meta.env.DEV && (cfg.dev || (cfg.lab && isLocalHost()))) {
    const [{ createDebugTools }, { createDevOverlay }, { createLabPanel }] = await Promise.all([
      import('./debugHook.ts'), import('../ui/devOverlay.ts'), import('../ui/labPanel.ts'),
    ]);
    const tools = createDebugTools(g);
    if (cfg.dev) { window.__WH__ = tools.debug; createDevOverlay(root, g); }
    if (cfg.lab) createLabPanel(root, { lab: tools.lab, unlockAudio: () => g.unlockAudio() });
  }

  g.setPhase('title');
  g.start();
  card.setReady(true);
  window.__whBooted = true;
}
