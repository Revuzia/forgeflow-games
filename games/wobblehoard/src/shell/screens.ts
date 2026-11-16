// The secondary screens, loaded on demand (UI.md 8 B4b): Settings, How to play, Credits and the Photo card are `later-*` chunks (not first-play: G0b counts only the files a first
// play needs). THIS file is first-play and small: the two dynamic imports, the Settings HOST (an empty `section.panel#wh-settings` at boot that the chunk fills on the first
// open, so `.panel[data-open]` exists from the start like it always did), and the words a failed load needs. The Menu, the modal, the toasts, the error card and the pause
// stay in the main chunk (R19: `pause()` is synchronous, never a later chunk).
import type { SettingsPanel, SettingsPanelOptions } from '../ui/settingsPanel.ts';
import type { ResolvedSettings } from '../core/settings.ts';
import { h } from '../ui/dom.ts';

export type ScreensModule = typeof import('../ui/screens/later-screens.ts');
export type PhotoModule = typeof import('../ui/screens/later-photo.ts');
// (static strings on purpose: the bundler splits on the literal path)
export const loadScreens = (): Promise<ScreensModule> => import('../ui/screens/later-screens.ts');
export const loadPhoto = (): Promise<PhotoModule> => import('../ui/screens/later-photo.ts');

/** A screen's chunk did not arrive (offline, or a new version replaced the files). The browser keeps a FAILED dynamic import for the page's whole life (measured in Chromium: the
 *  same URL is never fetched again, a second `import()` rejects at once), so "try again" would be a lie: the dialog offers a reload, which is the retry that works. */
export const SCREEN_FAILED_TITLE = 'That screen did not load';
export const SCREEN_FAILED_TEXT = 'The game could not fetch it. Check your connection, then reload to try again.';
export const SCREEN_FAILED_RELOAD = 'Reload';
export const SCREEN_FAILED_LATER = 'Not now';
/** the Photo card could not be built (the picture could not be read or decoded) */
export const PHOTO_FAILED = 'The photo could not be shown. Try again.';

export interface SettingsHostOptions extends SettingsPanelOptions {
  /** the chunk did not arrive */
  onFail(): void;
  /** a load is taking a moment: dim the opener (aria-busy) after `delay` ms */
  onBusy?(opener: HTMLElement | undefined, on: boolean): void;
}
export interface SettingsHost extends SettingsPanel {
  /** resolves true when the panel is built and open; false when the load failed or a close came first */
  openAsync(from?: HTMLElement): Promise<boolean>;
  readonly loaded: boolean;
}

const BUSY_AFTER_MS = 150;

/** The Settings panel as the rest of the shell knows it (`isOpen`, `close`, `sync`, ...), built on first use. Until then `sync` remembers the latest settings. */
export function createSettingsHost(root: HTMLElement, o: SettingsHostOptions): SettingsHost {
  const shell = h('section', { class: 'panel', attrs: { id: 'wh-settings', 'data-open': 'false', 'data-haptics': String(o.hapticsSupported) } });
  shell.setAttribute('inert', '');
  root.append(shell);
  let real: SettingsPanel | null = null;
  let loading: Promise<SettingsPanel | null> | null = null;
  let latest: ResolvedSettings = o.settings;
  let want: { from?: HTMLElement } | null = null;

  const build = (): Promise<SettingsPanel | null> => {
    loading ??= loadScreens().then((m) => { real = m.createSettingsPanel(root, { ...o, settings: latest }, shell); return real; }).catch((e) => { console.error(e); loading = null; return null; });
    return loading;
  };
  const host: SettingsHost = {
    el: shell,
    get loaded() { return real !== null; },
    async openAsync(from) {
      if (real) { real.open(from); return true; }
      want = { from };
      const t = window.setTimeout(() => o.onBusy?.(from, true), BUSY_AFTER_MS);
      const r = await build();
      window.clearTimeout(t);
      o.onBusy?.(from, false);
      if (!r) { want = null; o.onFail(); return false; }
      if (!want) return false;   // closed while it loaded
      want = null;
      r.open(from);
      return true;
    },
    open(from) { void host.openAsync(from); },
    close(via) { want = null; real?.close(via); },
    toggle() { if (host.isOpen()) host.close('button'); else host.open(); },
    isOpen: () => real?.isOpen() ?? false,
    sync(s) { latest = s; real?.sync(s); },
    destroy() { real?.destroy(); shell.remove(); },
  };
  return host;
}
