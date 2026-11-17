// Boot and teardown: the DOM around the game core. Title card first (it is also the audio-unlock gesture), the three lanes' modules
// imported dynamically (so the title shows at once and a broken module becomes a friendly card, never a blank page), then the HUD,
// the settings panel, the squishy's keyboard target, the live region, input and lifecycle, and WebGL context loss.
//
// DEV ONLY (import.meta.env.DEV, so `vite build` drops the import and the module): ?dev=1 exposes window.__WH__ (debugHook.ts) and the
// stats overlay; ?lab=1 adds the sound lab. A production build contains no hook, no lab and no /__shot poster (audit findings 6 / 20).
import type { QualityTier, Settings, SoftBodyCtor } from '../contracts.ts';
import { genomeFromParam } from '../core/genome.ts';
import { SETTINGS_KEY, detectEnv, loadSettings, parseSettingsText, safeLocalStorage } from '../core/settings.ts';
import type { StorageSubscribe } from '../core/save.ts';
import { createProfileStore } from '../core/save.ts';
import { createCollection } from '../collection/index.ts';
import { mulberry32 } from '../core/rng.ts';
import { attachKeyboard } from '../input/keyboard.ts';
import { attachLifecycle } from '../input/lifecycle.ts';
import { attachPointerInput } from '../input/pointer.ts';
import { BOOT_TOTAL, createBootCard } from '../ui/bootCard.ts';
import { h, isCoarsePointer, prefersReducedMotion } from '../ui/dom.ts';
import { showErrorCard, webgl2Available } from '../ui/errorCard.ts';
import { layerCount } from '../ui/modal.ts';
import { setCalm } from '../ui/motion.ts';
import { createTitleCard } from '../ui/titleCard.ts';
import type { TitleChip, TitleChipId } from '../ui/titleCard.ts';
import type { Game } from './game.ts';
import { createGame } from './game.ts';
import { createAchievements } from './achievementsBinding.ts';
import type { Achievements } from './achievementsBinding.ts';
import { bindUi } from './hudBinding.ts';
import { DESTINATIONS, DEST_LABELS, TITLE_ORDER } from './destinations.ts';
import { installPauseCtl } from './pauseCtl.ts';
import { attachUiSound } from '../ui/uiSound.ts';

declare global { interface Window { __whBooted?: boolean } }

const QUALITIES = ['auto', 'low', 'med', 'high'] as const;
/** WebGL context loss: how long to wait for the context to come back before the give-up card */
export const CONTEXT_GIVE_UP_MS = 5000;

/** The title's destination chips (UI.md 6): a chip shows only when the screen behind it exists (the flags are shell/destinations.ts's: Settings since B4a; How to play and
 *  Credits come with B4b, Trophies with B6b, each in hudBinding.ts `openDestination`). */
export const TITLE_DESTINATIONS: Readonly<Record<TitleChipId, boolean>> = DESTINATIONS;
/** a chip press: the screen opens ABOVE the title (the title goes inert under it, focus returns to the chip) */
let openDestination: (id: TitleChipId, from: HTMLElement | null) => void = () => { /* the game is not built yet: a chip cannot be pressed before the title exists */ };
const titleChips = (all: boolean): TitleChip[] => TITLE_ORDER.filter((id) => all || TITLE_DESTINATIONS[id]).map((id) => ({
  id, label: DEST_LABELS[id], onPress: () => openDestination(id, document.querySelector<HTMLElement>(`.title [data-chip="${id}"]`)),
}));

interface UrlConfig { genomeParam: string | null; overrides: Partial<Settings>; muted: boolean; dev: boolean; lab: boolean; titleChips: boolean }

export function readUrl(search: string): UrlConfig {
  const p = new URLSearchParams(search);
  const overrides: Partial<Settings> = {};
  if (p.get('float') === '1') overrides.gravity = false;
  const q = p.get('quality');
  if (q && (QUALITIES as readonly string[]).includes(q)) overrides.quality = q as QualityTier | 'auto';
  return { genomeParam: p.get('genome'), overrides, muted: p.get('mute') === '1', dev: p.get('dev') === '1', lab: p.get('lab') === '1', titleChips: p.get('titlechips') === '1' };
}

const isLocalHost = (): boolean => /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);

function fail(root: HTMLElement, title: string, message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err ? String(err) : undefined;
  if (err) console.error(err);
  document.getElementById('boot')?.remove();   // the loading card sits above an error card
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
  const bootCard = createBootCard(document.getElementById('boot'));
  document.body.dataset.phase = 'boot';
  // the portal's pause contract exists from the first moment (a stub: nothing to pause yet); the real one replaces it once the Menu exists
  const noPause = { pause() { /* booting */ }, resume() { /* booting */ }, toggle() { /* booting */ } };
  window.__PAUSE__ = noPause;
  const cfg = readUrl(location.search);
  // the loading card follows the COUNT of finished boot events (3 imports, then createGame): the card, the bar and a window event (R09)
  const progress = (done: number): void => {
    bootCard.setProgress(done);
    window.dispatchEvent(new CustomEvent('wh:boot-progress', { detail: { done, total: BOOT_TOTAL } }));
  };
  let finished = 0;
  const tick = <T,>(m: T): T => { progress(++finished); return m; };
  progress(0);

  if (!webgl2Available()) {
    fail(root, 'This device can’t draw the squishy', 'Squish Keeper needs WebGL2 for its 3D jelly. Try a recent Chrome, Safari, Firefox or Edge, and make sure hardware acceleration is switched on.');
    window.__whBooted = true;
    return null;
  }

  const env = detectEnv();
  // the saved Calm setting (else the OS preference) is known before the first frame: the loading card and the title obey it, not just the game
  setCalm(loadSettings(safeLocalStorage(), env).calm ?? env.reducedMotion);
  // storage, the profile and the collection share ONE cross-tab subscription (window 'storage'); the profile first, so the collection's
  // starter ghost keeps the profile's starter id (src/collection/index.ts WIRING)
  const storage = safeLocalStorage();
  const subscribe: StorageSubscribe = (fn) => { const h = (e: StorageEvent): void => fn(e.key); window.addEventListener('storage', h); return () => window.removeEventListener('storage', h); };
  // DEV ONLY: a clock skew the dev meter accelerator pushes ahead (debugHook.ts); production reads the plain epoch clock
  const skew = { ms: 0 };
  const epochNow = import.meta.env.DEV ? () => Date.now() + skew.ms : () => Date.now();
  let game: Game | null = null;
  let playTargetFocus: (() => void) | null = null;

  let profile: ReturnType<typeof createProfileStore> | null = null;
  let hoard: ReturnType<typeof createCollection> | null = null;
  let ach: Achievements | null = null;
  try {
    const [{ SoftBody }, { createStage }, { createAudio }] = await Promise.all([
      import('../physics/softbody.ts').then(tick),
      import('../render/stage.ts').then(tick),
      import('../audio/engine.ts').then(tick),
    ]);
    profile = createProfileStore(storage, { subscribe });
    // DEV ONLY: ?dev=1&rseed=N makes the practice rolls repeatable (the harness's scripted practice loop); a build never reads it
    const rseed = import.meta.env.DEV && cfg.dev ? Number(new URLSearchParams(location.search).get('rseed')) : NaN;
    hoard = createCollection({ storage, profile: profile.profile, subscribe, now: epochNow, random: Number.isFinite(rseed) && rseed > 0 ? mulberry32(rseed >>> 0) : undefined });
    // the trophies (UI B6a): the Hoard passes through ONE observing wrapper, so every capsule, merge, task and touch the game feeds it is seen (nothing changes for the game)
    ach = createAchievements({ storage, now: epochNow, subscribe });
    game = createGame({
      canvas,
      storage,
      profile,
      collection: ach.observe(hoard),
      epochNow,
      // the play mat with contact (mat.ts): a whole squishy built at its mat spot is the face piece of frac 1 (contracts.ts PieceOpts)
      // CUT (cut.ts): one piece of a cut squishy, built with the contract's PieceOpts
      createBody: (g, o) => (o?.piece ? new (SoftBody as unknown as SoftBodyCtor)(g, { piece: o.piece })
        : o?.at ? new (SoftBody as unknown as SoftBodyCtor)(g, { piece: { frac: 1, chunk: false, at: o.at } }) : new SoftBody(g)),
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
    try { ach?.dispose(); } catch { /* ignore */ }
    try { hoard?.dispose(); } catch { /* ignore */ }
    try { profile?.dispose(); } catch { /* ignore */ }
    fail(root, 'The squishy didn’t wake up', 'Something went wrong while starting the game. Reloading usually fixes it.', err);
    window.__whBooted = true;
    return null;
  }
  const g: Game = game;
  progress(++finished);   // createGame done: the fourth and last event
  // the interface sounds: ONE delegated listener (ui/uiSound.ts); the hover rule comes from the audio module that is already loaded (a mouse or a pen, never a finger)
  const { hoverSoundAllowed } = await import('../audio/ui.ts');
  const detachUiSound = attachUiSound(document, {
    play: (p) => g.audio.ui?.(p), calm: () => g.settings.calm, tap: (k) => g.haptics.uiTap?.(k), hoverAllowed: hoverSoundAllowed,
  });

  // ---- the title card: built now that the game exists (its button unlocks audio and starts the play phase)
  const card = createTitleCard(root, {
    muted: g.muted,
    chips: titleChips(import.meta.env.DEV && cfg.titleChips),
    onStart(viaKeyboard) {
      // This handler IS the user gesture: unlock audio synchronously, before anything else.
      g.unlockAudio();
      g.setPhase('play');
      // keyboard: focus goes to the squishy (Space pokes at once); pointer: no focus ring over the toy
      if (viaKeyboard) playTargetFocus?.(); else (document.activeElement as HTMLElement | null)?.blur?.();
    },
    onSound: (m) => g.setMuted(m),
    onPoke: () => g.audio.ui?.({ kind: 'tick', calm: g.settings.calm }),
  });
  const offMute = g.on('mute', (m) => card.setMuted(m));
  document.body.dataset.phase = 'title';

  // ---- canvas size
  const resize = (): void => { g.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, Math.min(window.devicePixelRatio || 1, 3)); };
  resize();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);

  // ---- the DOM around the game (HUD, the squishy's keyboard target, settings, live region, reveal plate): hudBinding.ts
  const ui = bindUi(root, canvas, g, env, {
    onPlay: () => card.dismiss(),
    trophies: ach,   // B6b: the Trophies row and chip
    // a Settings opened from a title chip stands over the title: the title is inert under it
    onSettingsOpenChange: (open) => { if (card.isShown()) card.el.toggleAttribute('inert', open); },
  });
  playTargetFocus = () => ui.play.focus();
  const trophies: Achievements = ach;
  const offTrophies = trophies.attach(g, { announce: (t) => ui.announcer.say(t) });   // B6a: the game's real events -> trophies -> the portal bridge (standalone: posts nothing)
  openDestination = (id, from) => { if (g.phase === 'title') ui.openDestination(id, from ?? undefined); };
  const removePause = installPauseCtl({ phase: () => g.phase, menu: ui.menu });

  // ---- input + lifecycle
  const detachPointer = attachPointerInput(canvas, g);
  // the keys (UI.md 4.5): 1 2 3 and C S pick tools, H the Hoard, [ ] switch, F full screen and P the Menu (B4's entry points: shell/entryStubs.ts, no-ops until B4)
  const detachKeys = attachKeyboard(window, g, {
    onEscape: () => ui.escape(),
    // LOCK: Escape lets the locked lobes go first, unless one of the things UI.md 4.5 would close is open (the More popover, a modal or photo card, the Menu, Settings, the Hoard)
    panelOpen: () => ui.hoard.isOpen || ui.panel.isOpen() || ui.menu.isOpen || layerCount() > 0 || !!document.querySelector('#wh-dock .dock-more[aria-expanded="true"]'),
    shortcutsEnabled: () => g.settings.shortcuts,
    onKeyUsed: () => ui.keyUsed(),
    onHoard: () => { if (g.phase === 'play') ui.hoard.toggle(); },
    onSwitch: (dir) => { if (g.phase === 'play' && !ui.hoard.isOpen) ui.switchBy(dir); },
    onTool: (id) => { if (g.phase === 'play') ui.pickTool(id); },
    onFullscreen: () => { if (g.phase === 'play') void ui.toggleFullscreen(); },
    onMenu: () => { if (g.phase === 'play' && !ui.hoard.isOpen) ui.openMenu(); },
    onHelp: () => { ui.openHelp(); },   // ? : How to play (B4b; in play with nothing else open)
  });
  const detachLife = attachLifecycle(g);

  // ---- PLAYGROUND: the life chunk (shell/later-life.ts: LIFE, the Journal, Home's things), requested AFTER the first frame of play (D-69), so it is never in
  // the first-play download; until it lands Home is today's toy (one squishy, no brain, no things) and game.ts's early log keeps the player's events.
  // A load that fails retries at the next idle moment and never breaks play.
  let lifeTries = 0, lifeTimer = 0, lifeGone = false, lifeUiOff: () => void = () => { /* nothing yet */ };
  const loadLife = (): void => {
    if (lifeGone || g.life || g.phase !== 'play') return;
    lifeTries++;
    import('./later-life.ts').then((m) => {
      if (lifeGone || g.life) return;
      const host = m.attachLifeHost(g, {
        storage, subscribe,
        say: (t) => ui.announcer.say(t),
        moment: (t) => { ui.toasts.show('success', t, { ms: 3200 }); },
        stampHaptic: () => { try { g.haptics.uiTap?.('ready'); } catch { /* none */ } },
        phone: () => isCoarsePointer() || Math.min(window.innerWidth, window.innerHeight) < 600,
        reducedMotion: () => prefersReducedMotion(),
      });
      // (a tapped wish reads its card's line, from the screens chunk on demand: QUESTS 8 / 15)
      if (host) { const taps = m.attachBubbleTaps(root, canvas, host, (t) => ui.announcer.say(t), (sp, k, t) => import('../ui/later-journal.ts').then((j) => j.wishLine(sp, k, t))); lifeUiOff = () => taps.destroy(); }
      ui.lifeAttached();
    }).catch((e: unknown) => {
      console.error(e);
      if (lifeTries < 5) lifeTimer = window.setTimeout(loadLife, 3000 * lifeTries);
    });
  };
  const offLifePhase = g.on('phase', (ph) => { if (ph === 'play' && !g.life) requestAnimationFrame(() => { lifeTimer = window.setTimeout(loadLife, 0); }); });

  // another tab changed the settings: follow it (the 'storage' event fires in the OTHER tabs only)
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== SETTINGS_KEY) return;
    const st = parseSettingsText(e.newValue, env);
    if (st) g.adoptExternalSettings(st);
  };
  window.addEventListener('storage', onStorage);

  // ---- WebGL context loss (mobile browsers reclaim contexts): freeze input, stop held voices, tell the player; resume when it comes
  // back; after CONTEXT_GIVE_UP_MS a working give-up card (the loop stops, the phase is 'error', the ceremony sounds stop). Finding 1.
  let lostToast: { remove(): void } | null = null;
  let lostTimer = 0;
  const onLost = (e: Event): void => {
    e.preventDefault();
    g.suspend('context');
    lostToast?.remove();
    lostToast = ui.toasts.show('warning', 'The picture was interrupted. Hang on…', { sticky: true, urgent: true });   // stays until the picture comes back (or the give-up card)
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
    const [{ createDebugTools }, { createDevOverlay }, { createLabPanel }, { createUiHook }] = await Promise.all([
      import('./debugHook.ts'), import('../ui/devOverlay.ts'), import('../ui/labPanel.ts'), import('../ui/uiHook.ts'),
    ]);
    const tools = createDebugTools(g, { skew });
    if (cfg.dev) { window.__WH__ = tools.debug; window.__WH_UI__ = createUiHook(g, ui); createDevOverlay(root, g); }
    if (cfg.lab) createLabPanel(root, { lab: tools.lab, unlockAudio: () => g.unlockAudio() });
  }

  g.setPhase('title');
  g.start();
  bootCard.leave();   // the title is under it: the loading card fades away and the intro plays
  card.setReady(true);
  window.__whBooted = true;

  // teardown (a host that unmounts the game, a test): every listener off, the saves flushed, GL context and AudioContext released
  return () => {
    clearTimeout(lostTimer);
    lifeGone = true; clearTimeout(lifeTimer); offLifePhase(); lifeUiOff();
    offMute();
    removePause(); detachUiSound();
    detachPointer(); detachKeys(); detachLife();
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('resize', resize);
    window.visualViewport?.removeEventListener('resize', resize);
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    ro?.disconnect();
    offTrophies(); trophies.dispose();
    ui.destroy();
    g.dispose();   // flushes and disposes the collection; disposes stage and audio
    try { profile?.flush(); profile?.dispose(); } catch { /* ignore */ }
    if (import.meta.env.DEV && window.__WH__) delete window.__WH__;
    if (import.meta.env.DEV && window.__WH_UI__) delete window.__WH_UI__;
  };
}
