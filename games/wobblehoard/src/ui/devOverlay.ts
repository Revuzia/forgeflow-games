// ?dev=1: a tiny stats readout. It deliberately does not call audio.stats() (that call resets the analyser peak the
// harness reads), only the stage and body metrics.
import type { App } from '../app.ts';
import { h } from './dom.ts';

export function createDevOverlay(root: HTMLElement, app: Pick<App, 'stage' | 'body' | 'fps' | 'phase'>): { el: HTMLElement; destroy(): void } {
  const el = h('pre', { class: 'dev', attrs: { 'aria-hidden': 'true' } });
  root.append(el);
  const tick = (): void => {
    try {
      const s = app.stage.stats();
      const m = app.body.metrics;
      el.textContent = `${app.phase}  ${app.fps.toFixed(0)} fps  ${s.tier}  ${s.drawCalls} dc  ${(s.triangles / 1000).toFixed(1)}k tri\n`
        + `vol ${m.volume.toFixed(3)}  cmp ${m.compression.toFixed(2)}  str ${m.stretch.toFixed(2)}  fingers ${m.fingers}`;
    } catch { /* never let a readout break the page */ }
  };
  const timer = setInterval(tick, 300);
  tick();
  return { el, destroy() { clearInterval(timer); el.remove(); } };
}
