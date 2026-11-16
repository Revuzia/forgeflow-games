// The Photo card (UI.md 6.1): Snap > Save photo where a download cannot be confirmed (the portal's sandbox has no `allow-downloads`). The picture sits in a dialog as an
// `<img src="data:image/png...">` (`img-src data:` is allowed by the CSP, `blob:` is not) that the player can press and hold (touch) or right-click (mouse) and save; "Open in a new tab"
// opens the PNG itself and is shown only if the browser really opens one (it hides itself the first time `window.open` returns nothing; the sandbox has no
// `allow-popups-to-escape-sandbox`, so the new tab may inherit the sandbox: unverified, R19). A later-* chunk (`shell/screens.ts` imports it on the first photo).
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { jelly, keepFitted } from '../jelly/jelly.ts';
import { ARM_MS, openLayer } from '../modal.ts';
import { cue } from '../uiSound.ts';
import { PHOTO_DONE, PHOTO_HINT, PHOTO_LINE, PHOTO_NEW_TAB, PHOTO_TAB_BLOCKED, PHOTO_TITLE } from './photoCopy.ts';
import './photo.css';

export interface PhotoCardOpts {
  parent: HTMLElement;
  blob: Blob;
  /** the picture's text alternative ("Photo of your squishy, Dollop, Rare") */
  alt: string;
  say(text: string): void;
  returnFocus?: () => HTMLElement | null;
  onClose?(why: string): void;
}
export interface PhotoCard { readonly el: HTMLElement; readonly img: HTMLImageElement; readonly open: boolean; close(why?: string): boolean }

/** The PNG as a data URL (the one image source the CSP allows besides the page's own files). Rejects when the blob cannot be read. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === 'string' ? ok(r.result) : fail(new Error('photo: not a string')));
    r.onerror = () => fail(r.error ?? new Error('photo: unreadable'));
    r.readAsDataURL(blob);
  });
}

/** Read, decode, then show: a picture that cannot be decoded never flashes an empty card (the promise rejects and the caller says so). */
export async function showPhotoCard(o: PhotoCardOpts): Promise<PhotoCard> {
  const src = await blobToDataUrl(o.blob);
  const img = h('img', { class: 'photo-img', attrs: { alt: o.alt, draggable: 'true', tabindex: '0' } });
  img.src = src;
  await img.decode();
  if (!(img.naturalWidth > 0)) throw new Error('photo: empty picture');

  const armedAt = performance.now() + ARM_MS;
  const title = jelly(PHOTO_TITLE, { size: 'md', tone: 'amber', tag: 'h2' });
  title.id = 'wh-photo-title';
  title.classList.add('photo-title');
  const hint = h('p', { class: 'photo-hint', text: PHOTO_HINT, attrs: { id: 'wh-photo-hint' } });
  const note = h('p', { class: 'photo-note', attrs: { role: 'status' } });
  note.hidden = true;
  const done = h('button', { class: 'k-btn k-gel photo-done', attrs: { type: 'button', 'data-sound': 'none' } }, h('span', { class: 'k-btn-label', text: PHOTO_DONE }));
  const tab = h('button', { class: 'k-btn photo-tab', attrs: { type: 'button', 'data-sound': 'none' } }, icon('newTab'), h('span', { class: 'k-btn-label', text: PHOTO_NEW_TAB }));
  if (typeof window.open !== 'function') tab.hidden = true;
  const dialog = h('div', { class: 'k-modal photo-card', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wh-photo-title', 'aria-describedby': 'wh-photo-hint' } },
    title, h('figure', { class: 'photo-fig' }, img), h('div', { class: 'photo-side' }, hint, note, h('div', { class: 'photo-actions' }, tab, done)));
  const scrim = h('div', { class: 'k-scrim photo-scrim wh-modal', attrs: { 'data-modal': 'true', 'data-photo': 'true' } }, dialog);

  const layer = openLayer({
    el: scrim, parent: o.parent,
    initialFocus: () => done,
    returnFocus: o.returnFocus,
    onClose: (why) => { unfit(); cue(why === 'escape' ? 'back' : 'close'); o.onClose?.(why); },
  });
  const unfit = keepFitted(title, () => { const cs = getComputedStyle(dialog); return dialog.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); }, dialog);
  done.addEventListener('click', () => { if (performance.now() >= armedAt) layer.close('button'); });
  tab.addEventListener('click', () => {
    if (performance.now() < armedAt) return;
    // a navigation, unlike an image, may use a blob: URL; made now so the user gesture is the click
    let url = '';
    let win: Window | null = null;
    try { url = URL.createObjectURL(o.blob); win = window.open(url, '_blank'); } catch { win = null; }
    if (!win) {
      if (url) URL.revokeObjectURL(url);
      tab.hidden = true;
      note.textContent = PHOTO_TAB_BLOCKED;
      note.hidden = false;
      o.say(PHOTO_TAB_BLOCKED);
      img.focus({ preventScroll: true });
      return;
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
  cue('open');
  o.say(PHOTO_LINE);
  return { el: scrim, img, get open() { return layer.open; }, close: (why) => layer.close(why) };
}
