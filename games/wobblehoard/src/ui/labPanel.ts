// Sound lab (?lab=1, dev only): one button per voice. "Squish" is a hold button: press and keep it down to hear the
// continuous squelch with a scripted compression ramp, let go to end it. Works with mouse, touch and keyboard (Space/Enter).
import type { App } from '../app.ts';
import './dev.css';
import { h } from './dom.ts';

export interface LabPanel { el: HTMLElement; destroy(): void }

export function createLabPanel(root: HTMLElement, app: Pick<App, 'lab' | 'unlockAudio'>): LabPanel {
  const mk = (label: string, onClick: () => void): HTMLButtonElement =>
    h('button', { class: 'lab-btn', text: label, attrs: { type: 'button' }, on: { click: () => { app.unlockAudio(); onClick(); } } });

  const play = (k: 'poke' | 'release' | 'land' | 'pop' | 'blend'): HTMLButtonElement => mk(k, () => app.lab.play(k));

  const hold = h('button', { class: 'lab-btn', text: 'squish (hold)', attrs: { type: 'button', 'aria-label': 'squish, hold to keep it going' } });
  const start = (): void => { app.unlockAudio(); app.lab.holdStart(); hold.dataset.on = 'true'; };
  const end = (): void => { app.lab.holdEnd(); hold.dataset.on = 'false'; };
  hold.addEventListener('pointerdown', (e) => { e.preventDefault(); try { hold.setPointerCapture(e.pointerId); } catch { /* ignore */ } start(); });
  hold.addEventListener('pointerup', end);
  hold.addEventListener('pointercancel', end);
  hold.addEventListener('lostpointercapture', end);
  hold.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } });
  hold.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') end(); });
  hold.addEventListener('blur', end);

  const el = h('div', { class: 'lab', attrs: { role: 'group', 'aria-label': 'Sound lab (developer tool)' } },
    h('p', { class: 'lab-title', text: 'Sound lab' }),
    h('div', { class: 'lab-grid' }, play('poke'), hold, play('release'), play('land'), play('pop'), play('blend')));
  root.append(el);
  return { el, destroy() { end(); el.remove(); } };
}
