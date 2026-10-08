// The UI kit page (dev only). ?batch=B0 shows the pages of B0 (cumulative), ?calm=1 / ?quality=low set the body hooks the shell sets in the game.
// The theme tokens are installed exactly like main.ts does (installTheme on :root); the three kit sheets load in the production order.
import '../../src/ui/base.css';
import '../../src/ui/kit.css';
import '../../src/ui/a11y.css';
import './kitpage.css';
import { h } from '../../src/ui/dom.ts';
import { installTheme } from '../../src/ui/theme.ts';
import { installLayout } from '../../src/ui/layout.ts';
import { setCalm } from '../../src/ui/motion.ts';
import { sectionsUpTo } from './pages/index.ts';

declare global { interface Window { __kitReady?: boolean; __kitErrors?: string[]; __kit?: { sections: string[] } } }

window.__kitErrors = [];
window.addEventListener('error', (e) => window.__kitErrors!.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__kitErrors!.push('rejection: ' + String(e.reason)));

const q = new URLSearchParams(location.search);
const batch = q.get('batch') ?? 'B0';
const only = q.get('only')?.split(',').filter(Boolean) ?? [];

installTheme();
setCalm(q.get('calm') === '1');
if (q.get('quality')) document.body.dataset.quality = q.get('quality')!;
const layout = installLayout();

const root = document.getElementById('kit')!;
const head = h('header', { class: 'kp-head' }, h('h1', { text: `UI kit ${batch}` }), h('p', { attrs: { id: 'kp-info' } }));
root.append(head);
const sections = sectionsUpTo(batch).filter((s) => !only.length || only.includes(s.id));
for (const s of sections) {
  const sec = h('section', { class: 'kp-sec', attrs: { id: `sec-${s.id}`, 'aria-label': s.title } }, h('h2', { text: s.title }), s.note ? h('p', { class: 'kp-note', text: s.note }) : null);
  try { s.build(sec, { layout }); } catch (e) { window.__kitErrors!.push(`${s.id}: ${e instanceof Error ? e.stack : String(e)}`); sec.append(h('p', { text: `BUILD FAILED: ${String(e)}` })); }
  root.append(sec);
}
const info = (): void => {
  const l = layout.current();
  const el = document.getElementById('kp-info');
  if (el) el.textContent = `${innerWidth} x ${innerHeight} | layout ${l.layout}${l.short ? ' short' : ''}${l.tall ? ' tall' : ''} | calm ${document.body.dataset.calm} | font ${getComputedStyle(document.body).fontFamily.split(',')[0]}`;
};
info();
layout.onChange(info);
window.__kit = { sections: sections.map((s) => s.id) };
window.__kitReady = true;
