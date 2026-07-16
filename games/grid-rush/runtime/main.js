import { GridRushGame } from './game.js';

function showBootError(err) {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  console.error('[Grid Rush] boot failed', err);
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
    'background:#070412;color:#ff8ad8;font:14px/1.5 ui-monospace,monospace;padding:2rem';
  el.innerHTML =
    `<div style="max-width:640px;border:1px solid #00f0ff;padding:1.5rem;border-radius:10px;background:rgba(8,4,20,0.92)">` +
    `<div style="color:#00f0ff;letter-spacing:0.12em;margin-bottom:0.75rem">Grid Rush · BOOT FAULT</div>` +
    `<pre style="white-space:pre-wrap;word-break:break-word;color:#e8f7ff;font-size:12px">${msg
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre>` +
    `<p style="margin-top:1rem;color:#aab;font-size:12px">Serve over HTTP (not file://). Open DevTools Console.</p></div>`;
  document.body.appendChild(el);
}

try {
  // eslint-disable-next-line no-new
  new GridRushGame();
  console.info('%cGrid Rush', 'color:#00f0ff;font-size:16px;font-weight:bold', '— hover circuits · original gadgets');
} catch (err) {
  showBootError(err);
}
