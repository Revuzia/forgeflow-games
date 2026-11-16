// DEV ONLY: window.__WH_UI__, the interface's handle for the harness (beside debugHook.ts's __WH__; boot.ts imports this module only under `import.meta.env.DEV`, so a production build
// contains neither the hook nor this file). The flows that only need Settings no longer click a gear (UI.md 9.1: the HUD button is the Menu now); they call `openSettings()`.
import type { Game } from '../shell/game.ts';
import type { UiBinding } from '../shell/hudBinding.ts';
import type { DestId } from '../shell/destinations.ts';
import { loadPhoto } from '../shell/screens.ts';
import { layerCount } from './modal.ts';
import { openModal } from './modal.ts';
import type { ModalOpts } from './modal.ts';
import type { ToastKind, ToastOpts } from './toast.ts';
import { uiSoundStats } from './uiSound.ts';

export interface UiHook {
  /** open the Settings panel directly (no Menu, no game pause); resolves when it is built (a later-* chunk) and open */
  openSettings(): Promise<boolean>;
  /** open any destination (settings, howto, credits, trophies) the way a Menu row does; resolves when it is open */
  openDestination(id: DestId): Promise<boolean>;
  /** show the Photo card for a picture (a PNG blob; the default is a 640x360 test card) */
  openPhoto(blob?: Blob): Promise<boolean>;
  closeSettings(): void;
  settingsOpen(): boolean;
  openMenu(): boolean;
  closeMenu(why?: string): boolean;
  menuOpen(): boolean;
  /** show a toast of a kind (`sticky` ones come back removable) */
  toast(kind: ToastKind, text: string, o?: ToastOpts): void;
  toasts(): { visible: number; waiting: number; offline: boolean };
  /** open a small dialog (the modal's reference build) */
  modal(o: ModalOpts): void;
  layers(): number;
  fullscreen(): { supported: boolean; available: boolean; on: boolean };
  /** the cues that reached the audio sink, by kind */
  cues(): { cues: number; kinds: Readonly<Record<string, number>> };
}

declare global { interface Window { __WH_UI__?: UiHook } }

export function createUiHook(g: Game, ui: UiBinding): UiHook {
  void g;
  return {
    openSettings: () => ui.openDestination('settings'),
    openDestination: (id) => ui.openDestination(id),
    openPhoto: async (blob) => {
      const b = blob ?? await new Promise<Blob>((ok, fail) => {
        const c = document.createElement('canvas'); c.width = 640; c.height = 360;
        const x = c.getContext('2d');
        if (x) { const gr = x.createLinearGradient(0, 0, 640, 360); const v = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim(); gr.addColorStop(0, v('--wh-amber')); gr.addColorStop(1, v('--wh-lagoon')); x.fillStyle = gr; x.fillRect(0, 0, 640, 360); }
        c.toBlob((r) => (r ? ok(r) : fail(new Error('no blob'))), 'image/png');
      });
      const m = await loadPhoto();
      await m.showPhotoCard({ parent: document.getElementById('ui') ?? document.body, blob: b, alt: 'Test photo', say: () => {} });
      return true;
    },
    closeSettings: () => { ui.panel.close('button'); },
    settingsOpen: () => ui.panel.isOpen(),
    openMenu: () => ui.openMenu(),
    closeMenu: (why) => ui.menu.close(why),
    menuOpen: () => ui.menu.isOpen,
    toast: (kind, text, o) => { ui.toasts.show(kind, text, o); },
    toasts: () => ({ visible: ui.toasts.visibleCount(), waiting: ui.toasts.waitingCount(), offline: !ui.toasts.banner.hidden }),
    modal: (o) => { openModal(o); },
    layers: () => layerCount(),
    fullscreen: () => ({ supported: ui.fullscreen.supported, available: ui.fullscreen.available, on: ui.fullscreen.isOn() }),
    cues: () => uiSoundStats(),
  };
}
