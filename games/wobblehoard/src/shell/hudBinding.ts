// HUD binding: the DOM side of the game core. It builds the HUD, the squishy's keyboard target, the settings panel, the live region,
// the reveal plate and the toast, and maps the game's events onto them (and the DOM's clicks onto the game). Nothing here simulates or
// decides: it only shows what game.ts reports. SHELL-2b adds the Hoard here: hud.slot is the bottom-centre slot for its button, and
// game.hoard / game.focusInstance / game.restorePrimary / game.playMerge / game.holdInput are its seams.
import type { TierName } from '../contracts.ts';
import type { SettingsEnv } from '../core/settings.ts';
import { createAnnouncer } from '../ui/announcer.ts';
import type { Announcer } from '../ui/announcer.ts';
import { h, isCoarsePointer } from '../ui/dom.ts';
import { tierLabel } from '../ui/gem.ts';
import { createHud } from '../ui/hud.ts';
import type { Hud } from '../ui/hud.ts';
import { createPlayTarget } from '../ui/playTarget.ts';
import type { PlayTarget } from '../ui/playTarget.ts';
import { PLATE_MS, createRevealPlate, plateText } from '../ui/revealPlate.ts';
import type { RevealPlate } from '../ui/revealPlate.ts';
import { createSettingsPanel } from '../ui/settingsPanel.ts';
import type { SettingsPanel } from '../ui/settingsPanel.ts';
import { createHoard } from '../ui/hoard/panel.ts';
import type { HoardUi } from '../ui/hoard/panel.ts';
import { createQuickSwitch } from '../ui/quickSwitch.ts';
import type { SwitchChoice } from '../ui/quickSwitch.ts';
import { warmSpeciesIcons } from '../ui/speciesIcon.ts';
import type { Game, PlayLabel } from './game.ts';
import { createHoardEnv } from './hoardEnv.ts';
import '../ui/hoard.css';

export interface UiBinding {
  readonly hud: Hud;
  readonly panel: SettingsPanel;
  readonly play: PlayTarget;
  readonly plate: RevealPlate;
  readonly announcer: Announcer;
  /** SHELL-2b: the Hoard (shelf, card, gift, today, merge pad, Tidy-up) */
  readonly hoard: HoardUi;
  toast(text: string, ms?: number): void;
  /** Escape outside a ceremony: close what is open (settings, the plate); true = something closed */
  escape(): boolean;
  /** a key reached the toy: the Keys line and the keyboard hint wording */
  keyUsed(): void;
  /** [ / ]: switch to the oldest / the newest squishy of the quick switcher */
  switchBy(dir: -1 | 1): void;
  destroy(): void;
}

export const labelText = (l: PlayLabel): string => `${l.species}, ${tierLabel(l.tier)}${l.nickname ? `, called ${l.nickname}` : ''}`;

export function bindUi(root: HTMLElement, canvas: HTMLCanvasElement, g: Game, env: SettingsEnv, o: { onPlay(): void }): UiBinding {
  const off: Array<() => void> = [];
  let hoardUi: HoardUi | null = null;
  const announcer = createAnnouncer(root);
  let panel: SettingsPanel | null = null;
  const hud = createHud(root, {
    label: g.label, muted: g.muted,
    onGear: () => { if (hoardUi?.isOpen) hoardUi.close(); panel?.toggle(); },
    onMute: () => g.toggleMute(),
    onOpenCapsule: () => { g.unlockAudio(); void g.capsules.openNext(); },
  });
  const play = createPlayTarget(root);
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
  const p: SettingsPanel = panel;

  // ---- the Hoard (SHELL-2b): its HUD button and the play mat's "put back" chip live in the HUD's bottom-centre slot
  const hoard: HoardUi = createHoard(root, createHoardEnv(g, {
    announce: (t) => announcer.say(t),
    toast: (t) => toast(t),
    returnFocus: () => (g.phase === 'play' ? play.el : null),
  }));
  hoardUi = hoard;
  hud.slot.append(hoard.button, hoard.matChip);
  hoard.button.addEventListener('click', () => { if (p.isOpen()) p.close('escape'); }, { capture: true });
  off.push(warmSpeciesIcons());

  // ---- the quick switcher (SHELL-2b): the squishies played lately, then the hearted ones, one tap to play with
  const pick = (id: string): void => {
    const r = g.switchTo(id);
    if (r === 'queued') announcer.say('Switching when this is done.');
    else if (r !== 'done') toast('That one could not come out. Try another.');
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
  const refreshSwitch = (): void => qs.set(choices());
  refreshSwitch();
  off.push(g.on('identity', () => refreshSwitch()), g.hoard.onChange(() => refreshSwitch()), () => qs.destroy());

  let toastEl: HTMLElement | null = null;
  let toastTimer = 0;
  const toast = (text: string, ms = 3200): void => {
    toastEl?.remove();
    toastEl = h('div', { class: 'toast', text, attrs: { 'aria-hidden': 'true' } });   // the live region says it; the toast only shows it
    root.append(toastEl);
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toastEl?.remove(); toastEl = null; }, ms);
  };

  // ---- game -> UI
  let gravityWas = g.settings.gravity;
  let plateAt = 0;
  const applyCalm = (calm: boolean): void => { document.body.dataset.calm = String(calm); };
  applyCalm(g.settings.calm);
  off.push(
    g.on('settings', (s) => {
      p.sync(s);
      applyCalm(s.calm);
      if (s.gravity !== gravityWas) { gravityWas = s.gravity; announcer.say(s.gravity ? 'On the table' : 'Floating'); }
    }),
    g.on('mute', (m) => { hud.setMuted(m); announcer.say(m ? 'Sound off' : 'Sound on'); }),
    g.on('identity', (_id, l) => { hud.setLabel(l); setPlayLabel(l); if (!g.ceremonies.active) announcer.say(`Your squishy: ${labelText(l)}`); }),
    g.on('interaction', () => { hud.interact(); if (plate.shown && !g.ceremonies.active) plate.hide(); }),
    g.on('meter', (m) => { hud.meter.set(m); }),
    g.on('capsuleReady', (n) => { hud.meter.pulse(g.settings.calm); announcer.say(n > 1 ? `A capsule is ready. ${n} waiting.` : 'A capsule is ready.'); }),
    g.on('message', (t) => { toast(t); announcer.say(t); }),
    g.on('notice', (t) => { announcer.say(t); }),
    g.on('ceremony', (e) => {
      if (e.type === 'start') { hud.meter.setBusy(true); plate.hide(); document.body.dataset.ceremony = e.kind; return; }
      const i = e.info;
      const info = { species: i.speciesName, tier: i.item.tier as TierName, isNew: i.item.isNew, copies: i.item.copies, tierUp: i.tierUp, nickname: i.item.nickname };
      if (e.type === 'reveal') { plate.show(info); plateAt = g.clock.now(); announcer.say(plateText(info)); return; }
      hud.meter.setBusy(false);
      delete document.body.dataset.ceremony;
    }),
    // the plate leaves PLATE_MS of game time after the reveal (the gesture clock: frozen while paused, stepped by DebugHook.step)
    g.onStep(() => { if (plate.shown && !g.ceremonies.active && g.clock.now() - plateAt >= PLATE_MS) plate.hide(); }),
    g.on('phase', (ph) => {
      document.body.dataset.phase = ph;
      if (ph === 'play') { hud.setActive(true); o.onPlay(); }
    }),
  );
  hud.meter.set(g.capsules.reading);
  { const n = g.collection.loadNotice(); if (n) { toast(n, 6000); announcer.say(n); } }

  // ---- the play target follows the squishy on screen (CSSOM writes only; re-placed every frame while it has focus)
  let placeRaf = 0;
  const place = (): void => { play.place(g.host.bodyScreen()); };
  const placeLoop = (): void => { placeRaf = 0; place(); if (play.focused) placeRaf = requestAnimationFrame(placeLoop); };
  const onFocus = (): void => { if (!placeRaf) placeRaf = requestAnimationFrame(placeLoop); };
  play.el.addEventListener('focus', onFocus);
  const placeTimer = window.setInterval(place, 250);
  const onTab = (e: KeyboardEvent): void => { if (e.key === 'Tab') document.body.dataset.kbd = '1'; };
  window.addEventListener('keydown', onTab, { capture: true, passive: true });

  return {
    hud, panel: p, play, plate, announcer, hoard, toast,
    escape() {
      if (p.isOpen()) { p.close('escape'); return true; }
      if (hoard.escape()) return true;
      if (plate.shown) { plate.hide(); return true; }
      return false;
    },
    keyUsed() { document.body.dataset.kbd = '1'; if (!isCoarsePointer()) hud.setHintMode('keyboard'); },
    switchBy(dir) {
      const list = choices().slice(0, 4);
      if (!list.length) { announcer.say('No other squishy to switch to yet.'); return; }
      pick((dir > 0 ? list[0] : list[list.length - 1]).id);
    },
    destroy() {
      for (const f of off.splice(0)) f();
      clearInterval(placeTimer); clearTimeout(toastTimer); cancelAnimationFrame(placeRaf);
      play.el.removeEventListener('focus', onFocus);
      window.removeEventListener('keydown', onTab, { capture: true });
      toastEl?.remove(); hoard.destroy(); hud.destroy(); p.destroy(); play.destroy(); plate.destroy(); announcer.destroy();
    },
  };
}
