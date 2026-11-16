// B4a page: THE FIRST-PLAY OVERLAYS (UI.md 6, 8 B4a). Specimens (`overlay-parts`: every toast kind, the sticky offline notice, the modal, the error card) and two scenes at exactly the
// viewport's size (`menu-scene`: the REAL Menu over a mock HUD, `toast-scene`: the REAL toaster over the same), so a sheet at the 8 kit sizes shows what the game shows.
import { h } from '../../../src/ui/dom.ts';
import { icon } from '../../../src/ui/icons.ts';
import { createMenu } from '../../../src/ui/menu.ts';
import { buildToast, createToaster } from '../../../src/ui/toast.ts';
import type { ToastKind } from '../../../src/ui/toast.ts';
import { showErrorCard } from '../../../src/ui/errorCard.ts';
import { button, modal } from '../parts.ts';
import { cell, sub } from './types.ts';
import type { KitSection } from './types.ts';
import '../b4a.css';

const KINDS: ReadonlyArray<[ToastKind, string, string | undefined]> = [
  ['info', 'Switched to Dollop.', undefined], ['success', 'Photo saved.', undefined], ['warning', 'The picture was interrupted. Hang on…', undefined],
  ['error', 'The photo could not be made. Try again.', undefined], ['trophy', 'First squish', 'Bronze trophy'],
];

const parts: KitSection = {
  id: 'overlay-parts', title: 'B4a parts: toasts, the modal, the error card',
  note: 'Toasts: an icon and words for every kind (never colour alone), glass on a container, aria-hidden (the live region speaks once). The modal is the kit dialog (the focus trap, Esc and the 250 ms arm are the game\'s). The error card: mascot, jelly heading, one gel button, the technical part folded under Details.',
  build(host) {
    host.append(sub('Toasts (each kind) on the panel and on white'));
    const stack = (): HTMLElement => h('div', { class: 'kp-toasts' }, ...KINDS.map(([k, t, s]) => buildToast(k, t, { sub: s })));
    host.append(cell('five kinds', stack(), { col: true }), cell('the same over white (the worst backdrop for glass)', stack(), { tone: 'white', col: true }));
    const banner = h('div', { class: 'net-banner k-toast k-glass', attrs: { 'data-kind': 'warning' } }, icon('warning'), h('div', { class: 'k-toast-text' }, h('span', { text: 'Offline. Your Hoard is read-only until we reconnect.' })));
    host.append(cell('the sticky offline notice (class net-banner) and the "+N more" pill', h('div', { class: 'kp-toasts' }, banner, h('div', { class: 'toast-more', text: '+2 more' })), { col: true }));

    host.append(sub('Modal (plain and danger)'));
    host.append(
      cell('plain', modal('Tidy up?', 'This merges your spare copies. You keep the best one of each.', [button({ kind: 'glass', label: 'Not now' }), button({ kind: 'gel', label: 'Tidy up' })]), { frame: true }),
      cell('danger (alertdialog): the safe answer has the focus in the game', modal('Start over?', 'This clears your squishies in this browser.', [button({ kind: 'coral', label: 'Start over' }), button({ kind: 'gel', label: 'Keep playing' })], true), { frame: true }));

    host.append(sub('Error card (contained here; fixed over everything in the game)'));
    const card = (o: Parameters<typeof showErrorCard>[1]): HTMLElement => { const box = h('div', { class: 'kp-contain kp-contain--card' }); showErrorCard(box, o); return box; };
    host.append(
      cell('with details (folded under Details)', card({ title: 'The squishy tripped', message: 'Something went wrong while drawing. Reloading usually fixes it.', detail: 'TypeError: Cannot read properties of undefined (reading length) at stage.ts:412' })),
      cell('no details, a long heading', card({ title: 'This device can’t draw the squishy', message: 'Squish Keeper needs WebGL2 for its 3D jelly. Try a recent Chrome, Safari, Firefox or Edge.' })));
  },
};

/** a mock HUD behind an overlay: the felt, a blob, the top row [FS, Sound, Menu] (FS not on a strip under 700 px) */
export function scene(id: string, title: string, note: string, fill: (stage: HTMLElement, menuBtn: HTMLElement) => void): KitSection {
  return {
    id, title, note, bleed: true,
    build(host) {
      const w = innerWidth, hgt = innerHeight;
      const stage = h('div', { class: 'kp-scene-b4' });
      stage.style.height = `${hgt}px`;
      const d = Math.round(Math.min(w * 0.7, hgt * 0.5));
      const blob = h('div', { class: 'kp-blob' });
      blob.style.width = blob.style.height = `${d}px`;
      blob.style.left = `${Math.round(w / 2 - d / 2)}px`; blob.style.top = `${Math.round(hgt * 0.45 - d / 2)}px`;
      const menuBtn = button({ kind: 'icon', icon: 'menu', name: 'Menu' });
      stage.append(blob, h('div', { class: 'kp-top' }, h('div', { class: 'kp-top-btns' },
        h('span', { class: 'kp-fs' }, button({ kind: 'icon', icon: 'fullscreen', name: 'Full screen', pressed: false })), button({ kind: 'icon', icon: 'soundOn', name: 'Mute sound', pressed: false }), menuBtn)));
      host.append(stage);
      fill(stage, menuBtn);
    },
  };
}

const menuScene = scene('menu-scene', 'Scene: the Menu open (the real Menu: a card, a bottom sheet, a strip card or the tiny full screen by layout)', 'Resume has the focus; the HUD is behind the scrim; Settings and the two switches are the rows that exist in B4a (Trophies, How to play, Credits come with their screens).', (stage, btn) => {
  let sound = true, full = false;
  const m = createMenu({
    root: stage, button: btn as HTMLButtonElement,
    rows: [{ id: 'settings', label: 'Settings', icon: 'gear', open: () => {} }],
    sound: { available: true, get: () => sound, set: (on) => { sound = on; } },
    fullscreen: { available: true, get: () => full, set: (on) => { full = on; } },
    onOpen: () => {}, onClose: () => {}, say: () => {},
  });
  m.open();
});

const toastScene = scene('toast-scene', 'Scene: the toast stack (the real toaster: two visible, then "+N more"; one at a time on the portal phone)', 'Under the top row, centred; in the game it stands over the top of the play field, never over the dock.', (stage) => {
  const t = createToaster(stage, { say: () => {}, held: () => false, tiny: () => document.body.dataset.layout === 'tiny' });
  for (const [k, text, s] of KINDS) t.show(k, text, { sub: s, sticky: true, sound: false, say: false });
});

export const b4aSections = (): KitSection[] => [parts, menuScene, toastScene];
