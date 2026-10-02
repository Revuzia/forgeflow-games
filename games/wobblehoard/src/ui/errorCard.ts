// Friendly full-screen error card: what failed, what to try, and a Reload button. Never a blank screen.
import { h } from './dom.ts';

export interface ErrorCardOptions {
  title: string;
  /** one or two plain sentences: what failed and what the player can do */
  message: string;
  /** technical detail, shown small (error.message). Optional. */
  detail?: string;
  buttonLabel?: string;
  onReload?: () => void;
}

export function showErrorCard(root: HTMLElement, o: ErrorCardOptions): HTMLElement {
  root.querySelector('.errorcard')?.remove();
  const btn = h('button', { class: 'cta cta-small', attrs: { type: 'button' }, on: { click: () => { (o.onReload ?? (() => location.reload()))(); } } },
    h('span', { class: 'cta-label', text: o.buttonLabel ?? 'Reload' }));
  const el = h('div', { class: 'errorcard', attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'wh-err-title', 'aria-describedby': 'wh-err-msg' } },
    h('div', { class: 'errorcard-box' },
      h('div', { class: 'errorcard-blob', attrs: { 'aria-hidden': 'true' } }),
      h('h2', { text: o.title, attrs: { id: 'wh-err-title' } }),
      h('p', { text: o.message, attrs: { id: 'wh-err-msg' } }),
      o.detail ? h('p', { class: 'errorcard-detail', text: o.detail.slice(0, 300) }) : null,
      btn));
  root.append(el);
  btn.focus({ preventScroll: true });
  return el;
}

/** Cheap WebGL2 feature test on a throwaway canvas (frees the context straight away). */
export function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}
