// HUD binding: the DOM side of the game core. It builds the HUD, the squishy's keyboard target, the settings panel, the live region,
// the reveal plate and the toast, and maps the game's events onto them (and the DOM's clicks onto the game). Nothing here simulates or
// decides: it only shows what game.ts reports. SHELL-2b adds the Hoard here: its button lives in the toolbar's Collection group (the strip layout keeps it in
// the HUD's bottom row, ui/layout.ts bindHoard), and game.hoard / game.focusInstance / game.restorePrimary / game.playMerge / game.holdInput are its seams.
// UI v3 (B4a): the top row is [Full screen, Sound, Menu]; the Menu (ui/menu.ts) is the pause screen and the way to Settings; the toasts are a stack at the top (ui/toast.ts);
// every overlay stands on ui/modal.ts's layer (inert behind, Esc, focus back). UI v3 (B3c): the tools are the TOOLBAR (ui/toolbar.ts, UI.md 4), always in the dock: no tray, no menu button for them. The options bars (Cut, Snap) ride in the dock's
// attachment slot; the keys 1 2 3 C S pick tools (input/keyboard.ts onTool); Escape closes things in the order of UI.md 4.5.
import type { TierName } from '../contracts.ts';
import type { SettingsEnv } from '../core/settings.ts';
import { createAnnouncer } from '../ui/announcer.ts';
import type { Announcer } from '../ui/announcer.ts';
import { h, isCoarsePointer, prefersReducedMotion } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { createSparks } from '../ui/sparks.ts';
import { createToolbar, GRAVITY_MODES, TOOLS } from '../ui/toolbar.ts';
import type { Toolbar, ToolId } from '../ui/toolbar.ts';
import { bindHoard, installLayout } from '../ui/layout.ts';
import type { LayoutHandle } from '../ui/layout.ts';
import { showsToolCaption, toolSourceOfPointer } from '../ui/hint.ts';
import type { ToolSource } from '../ui/hint.ts';
import { createSnapBar, paintTint } from '../ui/snapBar.ts';
import type { Sparks } from '../ui/sparks.ts';
import { tierLabel } from '../ui/gem.ts';
import { createHud } from '../ui/hud.ts';
import type { Hud } from '../ui/hud.ts';
import { createPlayTarget } from '../ui/playTarget.ts';
import type { PlayTarget } from '../ui/playTarget.ts';
import { PLATE_MS, createRevealPlate, plateText } from '../ui/revealPlate.ts';
import type { RevealPlate } from '../ui/revealPlate.ts';
import type { SettingsPanel } from '../ui/settingsPanel.ts';
import { createHoard } from '../ui/hoard/panel.ts';
import type { HoardUi } from '../ui/hoard/panel.ts';
import { QUICK_MAX, createQuickSwitch } from '../ui/quickSwitch.ts';
import type { SwitchChoice } from '../ui/quickSwitch.ts';
import { warmSpeciesIcons } from '../ui/speciesIcon.ts';
import { bindCut } from './cutBinding.ts';
import type { Game, PlayLabel } from './game.ts';
import { createHoardEnv } from './hoardEnv.ts';
import { downloadBlob, needsPhotoCard, photoEnv, routePhoto } from './photoRoute.ts';
import { PHOTO_FAILED, SCREEN_FAILED_LATER, SCREEN_FAILED_RELOAD, SCREEN_FAILED_TEXT, SCREEN_FAILED_TITLE, createSettingsHost, loadPhoto, loadScreens } from './screens.ts';
import { DESTINATIONS, DEST_ICONS, DEST_LABELS, MENU_ORDER } from './destinations.ts';
import type { DestId } from './destinations.ts';
import { createFullscreen } from './fullscreen.ts';
import type { Fullscreen } from './fullscreen.ts';
import { createMenu } from '../ui/menu.ts';
import type { Menu } from '../ui/menu.ts';
import { closeTopLayer, layerCount, openModal } from '../ui/modal.ts';
import { createToaster } from '../ui/toast.ts';
import { cue } from '../ui/uiSound.ts';
import type { Toaster } from '../ui/toast.ts';
import { setTrophyToastSink, trophyToastSub } from './trophyToast.ts';
import { createTrophiesLauncher } from './trophiesOpen.ts';
import type { Achievements } from './achievementsBinding.ts';
import { trophyLine } from '../portal/copy.ts';
import '../ui/hoard.css';
import { COPY } from '../collection/copy.ts';

export interface UiBinding {
  readonly hud: Hud;
  readonly panel: SettingsPanel;
  readonly play: PlayTarget;
  readonly plate: RevealPlate;
  readonly announcer: Announcer;
  /** SHELL-2b: the Hoard (shelf, card, gift, today, merge pad, Tidy-up) */
  readonly hoard: HoardUi;
  /** visible XP: the gain sparks (none under Calm effects or reduced motion: the ring glows instead) */
  readonly sparks: Sparks;
  /** the toolbar (UI.md 4): the tools, the Hoard group, the attachment slot */
  readonly toolbar: Toolbar;
  /** the Menu: the pause screen and the way to Settings (UI.md 6, 6.1) */
  readonly menu: Menu;
  /** the toast stack (info / success / warning / error / trophy, the sticky offline notice) */
  readonly toasts: Toaster;
  /** full screen (only where the page may use it) */
  readonly fullscreen: Fullscreen;
  /** the viewport layout (body[data-layout]) */
  readonly layout: LayoutHandle;
  /** an info toast (the old one-line toast; `toasts.show` has the kinds) */
  toast(text: string, ms?: number): void;
  /** open a destination (a title chip, a Menu row, the ? key): Settings, How to play, Credits (later-* chunks, loaded on first use); `from` is the control that gets the focus back.
   *  Resolves true when the screen is open; false when it could not load (a toast says so) or is already open. */
  openDestination(id: DestId, from?: HTMLElement): Promise<boolean>;
  /** the ? key: How to play, in play with nothing else open; true when it was asked for */
  openHelp(): boolean;
  /** the Menu (key P, Esc with nothing open): true when it opened */
  openMenu(): boolean;
  /** full screen on / off (key F, the [FS] button, the Menu switch); says so when the page may not */
  toggleFullscreen(want?: boolean): Promise<void>;
  /** a tool key (1 2 3 C S): the active Cut or Snap pressed again returns the Hand; a busy tool says why. True = the tool changed. */
  pickTool(id: ToolId): boolean;
  /** Escape outside a ceremony: close what is open, in the order of UI.md 4.5 (a transient popover, a photo card or modal, the Menu, Settings, the Hoard, the tool
   *  back to the Hand, the reveal plate, then the Menu); true = something closed or opened */
  escape(): boolean;
  /** a key reached the toy: the Keys line and the keyboard hint wording */
  keyUsed(): void;
  /** [ / ]: switch to the oldest / the newest squishy of the quick switcher */
  switchBy(dir: -1 | 1): void;
  destroy(): void;
}

/** Live-region lines of the toolbar (UI.md 4.5, word for word: the tool lines stay what the tray said). The Cut tool's line is cutText.ts's. */
export const TOOL_LINES: Record<Exclude<ToolId, 'cut'>, string> = {
  hand: 'Hand: poke, squish, stretch.',
  snap: 'Snap: drag to turn the camera (right-drag with a mouse), then Save photo. Escape goes back.',
};
/** why the tools are resting (the dock's `aria-disabled` reason and the live line a press or a key gets) */
export const TOOLS_BUSY = 'Tools rest while a capsule opens.';
export const CUT_UNAVAILABLE = 'Cut is not available here.';
export const FULLSCREEN_NO = 'Full screen isn’t available here.';

export const labelText = (l: PlayLabel): string => `${l.species}, ${tierLabel(l.tier)}${l.nickname ? `, called ${l.nickname}` : ''}`;

export function bindUi(root: HTMLElement, canvas: HTMLCanvasElement, g: Game, env: SettingsEnv, o: { onPlay(): void; /** Settings opened or closed (the title card goes inert under it) */ onSettingsOpenChange?(open: boolean): void; /** the trophies (B6b): the Trophies row and chip open their screen from these */ trophies?: Achievements }): UiBinding {
  const off: Array<() => void> = [];
  let hoardUi: HoardUi | null = null;
  const announcer = createAnnouncer(root);
  let panel: SettingsPanel | null = null;
  // the layout classifier (UI.md 4.1): body[data-layout | data-density | data-tall | data-dock], kept right on resize / rotation / fullscreen; every HUD rule keys off it
  const layout = installLayout();
  off.push(() => layout.dispose());
  const fs = createFullscreen();
  off.push(() => fs.destroy());
  let menu: Menu | null = null;
  const hud = createHud(root, {
    label: g.label, muted: g.muted,
    onMenu: () => { menu?.toggle(); },
    fullscreen: { available: fs.available, on: fs.isOn(), onToggle: () => { void toggleFullscreen(); } },
    onMute: () => g.toggleMute(),
    onOpenCapsule: () => { g.unlockAudio(); void g.capsules.openNext(); },
    onReady: () => g.haptics.uiTap?.('ready'),
    onPoke: () => g.audio.ui?.({ kind: 'tick', calm: g.settings.calm }),
  });
  const play = createPlayTarget(root);
  const setPlayLabel = (l: PlayLabel): void => {
    play.setLabel(`Squishy: ${labelText(l)}`);
    canvas.setAttribute('aria-label', `Your squishy, ${labelText(l)}: a soft translucent toy on a felt mat.`);
  };
  setPlayLabel(g.label);
  const plate = createRevealPlate(root);
  // a later-* chunk that did not arrive: a dialog with the retry that works (a reload; see shell/screens.ts)
  const screenFailed = (): void => {
    openModal({ title: SCREEN_FAILED_TITLE, text: SCREEN_FAILED_TEXT, buttons: [
      { label: SCREEN_FAILED_LATER, kind: 'glass' },
      { label: SCREEN_FAILED_RELOAD, kind: 'gel', onPress: () => { window.location.reload(); return false; } },
    ] });
  };
  // Settings is a later-* chunk (shell/screens.ts): an empty `section.panel#wh-settings` stands from the start and the first open fills it. The opener is dimmed (aria-busy)
  // when the chunk takes a moment, and a load that fails says so in a toast.
  const settingsHost = createSettingsHost(root, {
    settings: g.settings,
    hapticsSupported: env.vibrate,
    onChange: (k, v) => g.setSetting(k, v),
    onOpenChange: (open) => { document.body.dataset.settings = open ? 'open' : 'closed'; o.onSettingsOpenChange?.(open); },
    returnFocusTo: hud.menuButton,
    escapeFocusTo: () => (g.phase === 'play' ? play.el : null),
    onHowTo: (from) => { void openDestination('howto', from); },
    onBusy: (opener, on) => { const b = opener ?? hud.menuButton; if (on) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy'); },
    onFail: () => screenFailed(),
  });
  panel = settingsHost;
  const p: SettingsPanel = settingsHost;

  // ---- the toasts (ui/toast.ts): a stack at the top; the live region says each once; they wait while a ceremony runs or the reveal plate shows
  const toaster = createToaster(root, {
    say: (t) => announcer.say(t),
    held: () => g.ceremonies.active || g.ceremonies.pending || plate.shown,
    tiny: () => layout.current().layout === 'tiny',
  });
  off.push(() => toaster.destroy());
  const toast = (text: string, ms?: number): void => { toaster.show('info', text, { ms }); };
  // the renderer B6's seam waits for (shell/trophyToast.ts): a trophy toast with a tier chip and the name, "+N XP" only when signed in; the live region says it ONCE (trophyLine)
  setTrophyToastSink((t) => {
    const chip = h('span', { class: 'k-tier', attrs: { 'data-tier': t.tier } }, icon('trophy', 'k-icon'), h('span', { text: t.tier.charAt(0).toUpperCase() + t.tier.slice(1) }));
    toaster.show('trophy', t.name, { sub: trophyToastSub(t), extra: chip, say: false });
    announcer.say(trophyLine(t));
  });
  off.push(() => setTrophyToastSink(null));

  // ---- the Hoard (SHELL-2b): its HUD button and the play mat's "put back" chip live in the HUD's bottom-centre slot
  const hoard: HoardUi = createHoard(root, createHoardEnv(g, {
    announce: (t) => announcer.say(t),
    toast: (t) => toast(t),
    returnFocus: () => (g.phase === 'play' ? play.el : null),
  }));
  hoardUi = hoard;
  // ---- the toolbar (UI.md 4): the tools are always in the dock, the Hoard button in its Collection group; the Cut tool is drawn only when the physics can cut.
  // A tool is not pickable during a capsule reveal (a Cut picked there put its bar over the reveal and a Split in two then cut the NEW squishy: VERIFY B-U3): the
  // dock says so (aria-disabled + the reason) and a press or a key says it too. Under Settings a tool click closes the panel first (B-U4); a ceremony start puts
  // the Hand back (game.ts). The caption chip names a tool picked by touch or key (R10); a mouse has the tooltip, the game's own changes have the live line.
  const toolsNow = (): ToolId[] => (g.cut.supported ? ['hand', 'cut', 'snap'] : ['hand', 'snap']);
  const resting = (): boolean => g.ceremonies.active || g.ceremonies.pending;
  let toolSource: ToolSource = 'game';
  const setToolFrom = (id: ToolId, src: ToolSource): void => { toolSource = src; try { g.setTool(id); } finally { toolSource = 'game'; } };
  let clickSource: ToolSource = 'mouse';
  // Table | Float (UI.md 1.8, the owner's call of 2026-10-09): the pair sits beside the tools and is bound to the gravity setting; the G key (input/keyboard.ts) and the pair
  // both change that one setting, and the 'settings' event below repaints the pair, says the new face and plays its sound, whichever of them did it.
  const tb: Toolbar = createToolbar({
    layout, root: hud.el,
    onTool: (id) => { const src = clickSource; clickSource = 'mouse'; setToolFrom(id, src); },
    onBlocked: (_id, why) => announcer.say(why),
    gravity: { table: g.settings.gravity, onSet: (t) => g.setSetting('gravity', t) },
  });
  // (capture: before the toolbar's own handler) how this click came, and Settings gives way to the dock as it does to the Hoard
  tb.el.addEventListener('click', (e) => {
    if (!(e.target as Element | null)?.closest?.('.dock-tool, .dock-hoard')) return;
    clickSource = e.detail === 0 ? 'key' : toolSourceOfPointer((e as PointerEvent).pointerType ?? '');
    if (p.isOpen()) p.close('escape');
  }, true);
  // how a Table | Float press came (the pair or its row in More): a finger or a key gets the 1.4 s caption chip, as a tool does (R10); a mouse has the tooltip. The G key and the dev hook
  // reach the setting without a press here, so 'key' is the default.
  let gravSource: ToolSource = 'key';
  tb.el.addEventListener('click', (e) => {
    if (!(e.target as Element | null)?.closest?.('.dock-grav-opt, .dock-menuitem[data-grav]')) return;
    gravSource = e.detail === 0 ? 'key' : toolSourceOfPointer((e as PointerEvent).pointerType ?? '');
    window.setTimeout(() => { gravSource = 'key'; }, 0);   // (the setting changes inside this click; a press that changed nothing must not tag the next change)
  }, true);
  hud.slot.append(hoard.button, hoard.matChip);
  tb.adoptHoard(hoard.button);
  off.push(bindHoard(layout, hoard.button, { dock: tb.group, row: hud.slot }, hoard.matChip));
  let dockKey = '';
  const syncDock = (force = false): void => {
    const tools = toolsNow(), busy = resting();
    const k = `${busy}|${tools.join()}`;
    if (!force && k === dockKey) return;
    dockKey = k;
    tb.setAvailable(tools);
    // (the G key rests in a ceremony too: keyboard.ts `app.input.live`)
    tb.setDisabled(busy ? Object.fromEntries([...tools, 'gravity'].map((id) => [id, TOOLS_BUSY])) : null);
  };
  syncDock(true);
  off.push(g.onStep(() => syncDock()));
  /** a tool key: the active Cut or Snap pressed again returns the Hand; a tool that is busy or missing says why */
  const pickTool = (id: ToolId): boolean => {
    if (hoard.isOpen || g.phase !== 'play' || p.isOpen()) return false;   // (a tool key does nothing under a panel: Settings gives way to a CLICK on a tool, not to a key)
    if (!toolsNow().includes(id)) { announcer.say(CUT_UNAVAILABLE); return false; }
    if (resting()) { announcer.say(TOOLS_BUSY); return false; }
    const next: ToolId = id !== 'hand' && g.tool === id ? 'hand' : id;
    if (next === g.tool) return false;
    setToolFrom(next, 'key');
    return true;
  };
  hoard.button.addEventListener('click', () => { if (p.isOpen()) p.close('escape'); }, { capture: true });
  off.push(warmSpeciesIcons());

  // ---- full screen, the destinations and the MENU (UI.md 6, 6.1). The Menu is the pause screen: while it is open the game is suspended as 'covered' (the sim stops, the music
  // fades, no finger reaches the toy) and Resume / Esc / the close button resume it. A destination (Settings today) opens AFTER the Menu has closed and the game has resumed.
  const toggleFullscreen = async (want?: boolean): Promise<void> => {
    const ok = await (want === undefined ? fs.toggle() : fs.set(want));
    if (!ok) { toaster.show('info', FULLSCREEN_NO); menu?.sync(); }
  };
  off.push(fs.onChange((on, available) => { hud.setFullscreen(on, available); menu?.sync(); }));
  // The game is "covered" (suspended: the sim stops, the music fades) while the Menu, a reading screen (How to play, Credits) or the Photo card is up in play: each holds the cover
  // under its own key, and the game runs again when the last one lets go (Settings is the exception: a play-while-you-tweak panel).
  const covers = new Set<string>();
  const cover = (key: string, on: boolean): void => {
    const was = covers.size > 0;
    if (on) covers.add(key); else covers.delete(key);
    if (covers.size > 0 && !was) g.suspend('covered'); else if (covers.size === 0 && was) g.unsuspend('covered');
  };
  const openSettings = (from?: HTMLElement): Promise<boolean> => { if (hoard.isOpen) hoard.close(); return settingsHost.openAsync(from ?? hud.menuButton); };
  let guideBusy = false;   // one reading screen at a time (loading or open)
  const openGuide = async (id: 'howto' | 'credits', from?: HTMLElement): Promise<boolean> => {
    if (guideBusy) return false;
    guideBusy = true;
    // focus comes back to where it was: the control named, else whatever held it when the screen was asked for (the squishy for the ? key; after a Menu row, the control the Menu itself gave it back to)
    const here = document.activeElement;
    const opener = from ?? (here instanceof HTMLElement && here !== document.body && !here.closest('[inert]') ? here : hud.menuButton);
    const timer = window.setTimeout(() => { if (opener instanceof HTMLButtonElement) opener.setAttribute('aria-busy', 'true'); }, 150);
    let m: Awaited<ReturnType<typeof loadScreens>>;
    try { m = await loadScreens(); } catch (e) { console.error(e); guideBusy = false; screenFailed(); return false; } finally { window.clearTimeout(timer); opener.removeAttribute('aria-busy'); }
    const covering = g.phase === 'play';
    if (covering) cover('screen', true);
    (id === 'howto' ? m.openHowTo : m.openCredits)({
      parent: root,
      returnFocus: () => (opener.isConnected && !opener.closest('[inert]') ? opener : null),
      onClose: () => { guideBusy = false; if (covering) cover('screen', false); },
    });
    return true;
  };
  const trophies = o.trophies ? createTrophiesLauncher({ root, trophies: o.trophies, hoard: g.hoard, say: (t) => announcer.say(t), fail: (t) => { toaster.show('warning', t); } }) : null;
  const openDestination = async (id: DestId, from?: HTMLElement): Promise<boolean> => {
    switch (id) {
      case 'settings': return openSettings(from);
      case 'howto': case 'credits': return openGuide(id, from);
      case 'trophies': void trophies?.open(from ?? null); return !!trophies;   // B6b: a later-* chunk (shell/trophiesOpen.ts)
      default: return false;
    }
  };
  menu = createMenu({
    root, button: hud.menuButton,
    rows: MENU_ORDER.filter((id) => DESTINATIONS[id]).map((id) => ({ id, label: DEST_LABELS[id], icon: DEST_ICONS[id], open: () => { void openDestination(id); }, ...(id === 'trophies' && trophies ? { detail: () => trophies.detail() } : {}) })),
    sound: { available: true, get: () => !g.muted, set: (on) => g.setMuted(!on) },
    fullscreen: { get available() { return fs.available; }, get: () => fs.isOn(), set: (on) => { void toggleFullscreen(on); } },   // (read on every open: a refusal takes the row away)
    onOpen: () => { tb.escape(); cover('menu', true); trophies?.preload(); },
    onClose: () => { cover('menu', false); },
    say: (t) => announcer.say(t),
  });
  const m: Menu = menu;

  // ---- the quick switcher (SHELL-2b): the squishies played lately, then the hearted ones, one tap to play with
  const pick = (id: string): void => {
    const r = g.switchTo(id);
    if (r === 'queued') announcer.say('Switching when this is done.');
    else if (r !== 'done') toaster.show('warning', 'That one could not come out. Try another.');
  };
  const qs = createQuickSwitch(hud.el, pick);
  const choices = (): SwitchChoice[] => {
    const cur = g.identity.itemId;
    const out: SwitchChoice[] = [];
    const add = (id: string): void => {
      if (id === cur || out.some((c) => c.id === id)) return;
      const it = g.hoard.item(id);
      if (it) out.push({ id: it.id, species: it.species, name: it.name, tier: it.tier as TierName });
    };
    for (const id of g.history.recent()) add(id);
    for (const it of g.hoard.items()) if (it.fav) add(it.id);
    return out;
  };
  // the HUD rows the 3D capsule must not land under (render lane's optional setSafeInsets): the top bar and the bottom row (the quick
  // switcher above the name tag covers only the left edge; counting it would leave the capsule too little room); the dock's TRAY counts, not its options bar
  // (a bar comes and goes with the tool and must not move the capsule's spot); in the strip layout the tray is a top row; on change only
  let insetKey = '';
  const reportInsets = (): void => {
    const st = g.stage;
    if (typeof st.setSafeInsets !== 'function') return;
    const ih = window.innerHeight;
    if (!(ih > 0)) return;
    const topBar = hud.el.querySelector<HTMLElement>('.hud-top')?.getBoundingClientRect();
    const tray = tb.bar.getBoundingClientRect();
    const trayOnTop = layout.current().layout === 'strip';
    let bottomTop = ih;
    for (const e of [hud.el.querySelector<HTMLElement>('.hud-bottom')]) {
      if (!e || e.hidden) continue;
      const r = e.getBoundingClientRect();
      if (r.height > 0) bottomTop = Math.min(bottomTop, r.top);
    }
    if (!trayOnTop && tray.height > 0) bottomTop = Math.min(bottomTop, tray.top);
    let top = topBar && topBar.height > 0 ? Math.round(topBar.bottom) : 0;
    if (trayOnTop && tray.height > 0) top = Math.max(top, Math.round(tray.bottom));
    const bottom = Math.round(Math.max(0, ih - bottomTop));
    const k = `${top},${bottom}`;
    if (k === insetKey) return;
    insetKey = k;
    try { st.setSafeInsets({ top, bottom }); } catch (e) { console.error(e); }
  };
  const refreshSwitch = (): void => { qs.set(choices()); reportInsets(); };
  refreshSwitch();
  window.addEventListener('resize', reportInsets);
  off.push(() => window.removeEventListener('resize', reportInsets), layout.onChange(() => requestAnimationFrame(reportInsets)));
  off.push(g.on('identity', () => refreshSwitch()), g.hoard.onChange(() => refreshSwitch()), () => qs.destroy());

  // ---- offline (COLLECTION 9.9, signed in): the sticky offline toast (`.net-banner`) while the connection is gone, the ring keeps previewing; "Reconnected" once
  let offline = false;
  const netState = (gone: boolean): void => {
    if (gone === offline) return;
    offline = gone;
    toaster.offline(gone, COPY.offline);
    document.body.dataset.offline = String(gone);
    announcer.say(gone ? COPY.offline : COPY.reconnected);
  };

  // ---- game -> UI
  let gravityWas = g.settings.gravity;
  let plateAt = 0;
  const applyCalm = (calm: boolean): void => { document.body.dataset.calm = String(calm); };
  applyCalm(g.settings.calm);
  // Quality low: the glass goes solid (a11y.css body[data-quality="low"], UI.md 3.3)
  const applyQuality = (q: string): void => { document.body.dataset.quality = q; };
  applyQuality(g.settings.quality);
  off.push(
    g.on('settings', (s) => {
      p.sync(s);
      applyCalm(s.calm);
      applyQuality(s.quality);
      tb.setGravity(s.gravity);
      if (s.gravity !== gravityWas) {
        gravityWas = s.gravity;
        const m = GRAVITY_MODES.find((x) => x.table === s.gravity)!;
        announcer.say(m.line);
        if (showsToolCaption(gravSource)) tb.showCaption(m.label, m.hint);
        gravSource = 'key';
        cue(m.sound);   // (one cue per change, from the setting: the pair's buttons are silent themselves, `data-sound="none"`, so the G key and a press sound alike)
      }
    }),
    g.on('mute', (mu) => { hud.setMuted(mu); menu?.sync(); announcer.say(mu ? 'Sound off' : 'Sound on'); }),
    g.on('identity', (_id, l) => { hud.setLabel(l); setPlayLabel(l); if (!g.ceremonies.active) announcer.say(`Your squishy: ${labelText(l)}`); }),
    g.on('interaction', () => { hud.interact(); if (plate.shown && !g.ceremonies.active) plate.hide(); }),
    g.on('meter', (m) => { hud.meter.set(m); netState(m.offline); }),
    g.on('capsuleReady', (n) => { hud.meter.pulse(g.settings.calm); announcer.say(n > 1 ? `A capsule is ready. ${n} waiting.` : 'A capsule is ready.'); }),
    g.on('message', (t) => { toast(t); }),
    g.on('notice', (t) => { announcer.say(t); }),
    g.on('ceremony', (e) => {
      if (e.type === 'start') { tb.escape(); syncDock(); hud.meter.setBusy(true); plate.hide(); document.body.dataset.ceremony = e.kind; return; }
      const i = e.info;
      const info = { species: i.speciesName, tier: i.item.tier as TierName, isNew: i.item.isNew, copies: i.item.copies, tierUp: i.tierUp, nickname: i.item.nickname };
      if (e.type === 'reveal') { plate.show(info); plateAt = g.clock.now(); announcer.say(plateText(info)); return; }
      hud.meter.setBusy(false);
      delete document.body.dataset.ceremony;
      syncDock();
    }),
    // the plate leaves PLATE_MS of game time after the reveal (the gesture clock: frozen while paused, stepped by DebugHook.step)
    g.onStep(() => { if (plate.shown && !g.ceremonies.active && g.clock.now() - plateAt >= PLATE_MS) plate.hide(); }),
    g.on('phase', (ph) => {
      document.body.dataset.phase = ph;
      if (ph !== 'play') menu?.close('code');
      if (ph === 'play') { hud.setActive(true); o.onPlay(); requestAnimationFrame(reportInsets); }
    }),
  );
  hud.meter.set(g.capsules.reading);

  // ---- visible XP (FUN.md 2): sparks from the touch to the ring (or a soft glow under Calm effects), and the pending arc of a hold
  const sparks = createSparks(root);
  let gainedAt = -1;          // the step a touch last paid (the release of a held touch banks its arc)
  let steps = 0;
  let pendShown = 0, bankWait = 0;
  const BANK_WAIT_STEPS = 8;  // a held touch's release event may come a few steps after the finger lifts
  off.push(
    g.on('gain', (e) => {
      gainedAt = steps;
      const calm = g.settings.calm || prefersReducedMotion();
      const r = hud.meter.ring.getBoundingClientRect();
      if (calm || e.x === null || e.y === null || !r.width) { hud.meter.glow(true); return; }
      const c = canvas.getBoundingClientRect();
      const n = Math.min(6, Math.max(3, Math.round(2.5 + e.sp * 1.2)));   // a poke 3, a squeeze or a stretch 4 to 6
      const ms = sparks.burst(c.left + e.x, c.top + e.y, r.left + r.width / 2, r.top + r.height / 2, n);
      if (ms > 0) { hud.meter.hold(ms); window.setTimeout(() => hud.meter.glow(false), ms); } else hud.meter.glow(true);
    }),
    g.onStep(() => {
      steps++;
      const p = g.pendingFill();
      if (p > 0) {
        bankWait = 0;
        if (pendShown === 0 || Math.abs(p - pendShown) >= 0.002) { hud.meter.setPending(p); pendShown = p; }
      } else if (pendShown > 0) {
        // the hold ended: bank it when its release paid (now or within a few steps), else let it fade
        if (gainedAt >= steps - 1) { hud.meter.bankPending(true); pendShown = 0; bankWait = 0; }
        else if (++bankWait >= BANK_WAIT_STEPS) { hud.meter.bankPending(false); pendShown = 0; bankWait = 0; }
      }
    }),
    () => sparks.destroy(),
  );
  { const n = g.collection.loadNotice(); if (n) toaster.show('warning', n, { ms: 6000 }); }

  // ---- tools: the Cut bar and its blade line (cutBinding.ts), Snap's bar and backdrop tint, and the Save
  const cutB = bindCut(root, canvas, g, { announcer, toast });
  let tintX = 0, tintY = 0;
  const placeTint = (): void => {
    const c = canvas.getBoundingClientRect();
    const b = g.bodies.extras.length ? null : g.host.bodyScreen();
    tintX = b ? b.x : c.width / 2; tintY = b ? b.y : c.height * 0.55;
    snap.place(c.left + tintX, c.top + tintY, c.width, c.height);
  };
  const slug = (t: string): string => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'squishy';
  const dateTag = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // Snap > Save photo (UI.md 6.1): a page that can download keeps the download and the toast "Photo saved."; inside a frame (the portal's sandbox has no allow-downloads) or where a
  // download cannot even be tried, the Photo card (a later-* chunk) shows the picture to press-and-hold or right-click and save (shell/photoRoute.ts decides, structurally).
  const showPhotoCard = (blob: Blob): void => {
    loadPhoto().then((m) => m.showPhotoCard({
      parent: root, blob, alt: `Photo of your squishy, ${labelText(g.label)}`, say: (t) => announcer.say(t),
      onClose: () => cover('photo', false),
    }).then((card) => { if (card.open) cover('photo', true); }).catch((e) => { console.error(e); toaster.show('error', PHOTO_FAILED); }),
    (e) => { console.error(e); screenFailed(); });
  };
  // where the card is the way to save, its chunk is fetched as soon as Snap is picked, so a photo never waits for it (a failed fetch says so at once, not at Save)
  const warmPhotoCard = (): void => { if (needsPhotoCard(photoEnv())) loadPhoto().catch(() => { /* Save says so */ }); };
  let lastPhoto = '', saving = false;
  // Save: the button shows "Saving…" and the shutter dims first (a paint), then, in the next task, ONE clean frame is rendered and read in
  // that same task (the drawing buffer is not preserved), composited with the tint when there is one, and encoded. The PNG encode can hold
  // the main thread (measured: seconds under the software GL of the test machine), so a second click while saving does nothing.
  const savePhoto = (): void => {
    if (saving) return;
    saving = true;
    snap.setSaving(true);
    snap.shutter(g.settings.calm);
    window.setTimeout(capturePhoto, 40);
  };
  const capturePhoto = (): void => {
    const cv = g.stage.canvas;
    const name = `squish-keeper-${slug(g.label.species)}-${dateTag()}.png`;
    const done = (): void => { saving = false; snap.setSaving(false); };
    if (g.tool !== 'snap') { done(); return; }
    try {
      placeTint();
      g.stageUpdate(0, true);   // ONE clean frame now: the HUD is hidden and the drawing buffer is read in this same task
      let src: HTMLCanvasElement = cv;
      const t = snap.tint;
      if (t.color) {
        const c2 = document.createElement('canvas');
        c2.width = cv.width; c2.height = cv.height;
        const x = c2.getContext('2d');
        if (x) {
          x.drawImage(cv, 0, 0);
          const k = cv.width / Math.max(1, cv.clientWidth);
          paintTint(x, cv.width, cv.height, tintX * k, tintY * k, t.color);
          src = c2;
        }
      }
      src.toBlob((blob) => {
        done();
        if (!blob) { toaster.show('error', 'The photo could not be made. Try again.'); return; }
        lastPhoto = name;
        const route = routePhoto({ env: photoEnv(), card: () => showPhotoCard(blob), download: () => downloadBlob(blob, name) });
        if (route === 'download') toaster.show('success', 'Photo saved.');
      }, 'image/png');
    } catch (e) { console.error(e); done(); toaster.show('error', 'The photo could not be made. Try again.'); }
  };
  const snap = createSnapBar(root, { onSave: savePhoto, onDone: () => g.setTool('hand'), onTint: (t) => { announcer.say(`Backdrop: ${t.label}`); } });
  off.push(
    g.on('tool', (t) => {
      tb.setTool(t);
      document.body.dataset.tool = t;
      hud.toolTried();
      // the options bars ride in the dock's attachment slot: shown (and fitted) first, then attached; taken out of the slot first, then hidden (the dock gives the focus
      // that was in a removed bar back to the Hand button)
      if (t === 'snap') { placeTint(); snap.el.hidden = false; tb.attach(snap.el, 'snap'); snap.show(true); warmPhotoCard(); }
      else if (t === 'cut') { cutB.bar.show(true); tb.attach(cutB.bar.el, 'cut'); }
      else { tb.attach(null); snap.show(false); }
      if (t === 'hand' && (document.activeElement === document.body || !document.activeElement || tb.toolsEl.contains(document.activeElement))) tb.focusTool('hand');   // focus returns to the Hand button
      if (showsToolCaption(toolSource)) { const d = TOOLS.find((x) => x.id === t); if (d) tb.showCaption(d.label, d.hint); } else tb.hideCaption();
      announcer.say(t === 'cut' ? cutB.toolLine() : TOOL_LINES[t]);
      cutB.onTool(t);   // the Cut bar follows the tool; back in the Hand with pieces, the hint comes after the tool's line
      // a bar the dock let go of waits, hidden, in the UI root (it keeps its place in the DOM: the harness and the probes find `.cutbar` and `.snapbar` there)
      for (const bar of [cutB.bar.el, snap.el]) if (!bar.isConnected) root.append(bar);
      requestAnimationFrame(reportInsets);
    }),
    g.on('identity', () => syncDock()),
    () => { cutB.destroy(); snap.destroy(); tb.destroy(); },
  );
  document.body.dataset.tool = g.tool;
  void lastPhoto;

  // ---- the play target follows the squishy on screen (CSSOM writes only; re-placed every frame while it has focus)
  let placeRaf = 0;
  const place = (): void => { play.place(g.host.bodyScreen()); };
  const placeLoop = (): void => { placeRaf = 0; place(); if (play.focused) placeRaf = requestAnimationFrame(placeLoop); };
  const onFocus = (): void => { if (!placeRaf) placeRaf = requestAnimationFrame(placeLoop); };
  play.el.addEventListener('focus', onFocus);
  // The transient hint pill keeps clear of the waiting capsule's tap circle: on a landscape phone it stood across the capsule's foot (found by the
  // render lane, VERIFY_RENDER_B_R1 B-m4). It slides sideways (--hint-dx) to the nearer side that fits, and only when neither side does (a tiny
  // screen) does it wait, hidden, until the capsule is gone. Measured from the pill's LAYOUT box (offsetLeft less half its width: transforms and the
  // transition of its own shift do not count), so it never chases itself.
  const HINT_CLEAR = 10, HINT_GUTTER = 12;
  let hintDx = 0, hintYield = false;
  const avoidCapsule = (): void => {
    const el = hud.hintEl;
    let dx = 0, wait = false;
    const cap = g.capsules.screenPoint();
    if (cap && el.offsetWidth > 0) {
      const cv = canvas.getBoundingClientRect(), hr = hud.el.getBoundingClientRect();
      const cx = cv.left + cap.x, cy = cv.top + cap.y, rad = cap.r + HINT_CLEAR;
      const left = hr.left + el.offsetLeft - el.offsetWidth / 2, right = left + el.offsetWidth, top = hr.top + el.offsetTop, bottom = top + el.offsetHeight;
      const nx = Math.max(left, Math.min(cx, right)), ny = Math.max(top, Math.min(cy, bottom));
      if (Math.hypot(cx - nx, cy - ny) < rad) {
        const toLeft = (cx - rad) - right, toRight = (cx + rad) - left;
        const okL = left + toLeft >= HINT_GUTTER, okR = right + toRight <= window.innerWidth - HINT_GUTTER;
        if (okL && (!okR || -toLeft <= toRight)) dx = toLeft; else if (okR) dx = toRight; else wait = true;
      }
    }
    if (Math.abs(dx - hintDx) > 0.5) { hintDx = dx; el.style.setProperty('--hint-dx', `${dx.toFixed(1)}px`); }
    if (wait !== hintYield) { hintYield = wait; el.dataset.yield = String(wait); }
  };
  const placeTimer = window.setInterval(() => { place(); avoidCapsule(); if (g.tool === 'snap') placeTint(); }, 250);
  const onTab = (e: KeyboardEvent): void => { if (e.key === 'Tab') document.body.dataset.kbd = '1'; };
  window.addEventListener('keydown', onTab, { capture: true, passive: true });

  // a full-screen change ends with its own Escape (the browser leaves full screen on it): that one must not also open the Menu (UI.md 4.5, 8)
  let fullscreenAt = -Infinity;
  const onFullscreen = (): void => { fullscreenAt = performance.now(); };
  document.addEventListener('fullscreenchange', onFullscreen);
  off.push(() => document.removeEventListener('fullscreenchange', onFullscreen));

  return {
    hud, panel: p, play, plate, announcer, hoard, sparks, toolbar: tb, layout, toast, menu: m, toasts: toaster, fullscreen: fs,
    pickTool, openDestination, toggleFullscreen,
    openHelp: () => { if (g.phase !== 'play' || hoard.isOpen || layerCount() > 0) return false; void openDestination('howto'); return true; },
    openMenu: () => (g.phase === 'play' ? m.open() : false),
    // UI.md 4.5, first match wins (1 is keyboard.ts's: skip a running ceremony): the More popover, then 2 a photo card or modal and 3 the Menu (the layers of ui/modal.ts,
    // the top one first), 4 Settings, 5 the Hoard, 6 the tool back to the Hand, 7 the reveal plate, 8 nothing open: the Menu, unless a full-screen change just happened
    escape() {
      if (tb.escape()) return true;
      if (closeTopLayer('escape')) return true;
      if (p.isOpen()) { p.close('escape'); return true; }
      if (hoard.escape()) return true;
      if (g.tool !== 'hand') { g.setTool('hand'); return true; }   // Snap and Cut: Escape puts the Hand back
      if (plate.shown) { plate.hide(); return true; }
      if (g.phase === 'play' && performance.now() - fullscreenAt > 500) return m.open();
      return false;
    },
    keyUsed() { document.body.dataset.kbd = '1'; if (!isCoarsePointer()) hud.setHintMode('keyboard'); },
    switchBy(dir) {
      const list = choices().slice(0, QUICK_MAX);
      if (!list.length) { announcer.say('No other squishy to switch to yet.'); return; }
      pick((dir > 0 ? list[0] : list[list.length - 1]).id);
    },
    destroy() {
      for (const f of off.splice(0)) f();
      clearInterval(placeTimer); cancelAnimationFrame(placeRaf);
      play.el.removeEventListener('focus', onFocus);
      window.removeEventListener('keydown', onTab, { capture: true });
      menu?.close('code'); hoard.destroy(); hud.destroy(); p.destroy(); play.destroy(); plate.destroy(); announcer.destroy();
    },
  };
}
