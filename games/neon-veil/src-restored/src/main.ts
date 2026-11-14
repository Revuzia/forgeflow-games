import { Game } from './Game';

// Neon Veil — original neon sky dogfighter
// No voice / mic / talk features.

function showBootError(err: unknown) {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  console.error('[Neon Veil] boot failed', err);
  const el = document.createElement('div');
  el.id = 'boot-error';
  el.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
    'background:#0a0614;color:#ff8ad8;font:14px/1.5 ui-monospace,monospace;padding:2rem;text-align:left';
  el.innerHTML =
    `<div style="max-width:640px;border:1px solid #00f0ff;padding:1.5rem;border-radius:10px;background:rgba(8,4,20,0.92)">` +
    `<div style="color:#00f0ff;letter-spacing:0.12em;margin-bottom:0.75rem">Neon Veil · BOOT FAULT</div>` +
    `<pre style="white-space:pre-wrap;word-break:break-word;color:#e8f7ff;font-size:12px">${msg
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre>` +
    `<p style="margin-top:1rem;color:#aab;font-size:12px">Open DevTools (F12) → Console. Serve via Vite, not file://.</p>` +
    `</div>`;
  document.body.appendChild(el);
}

try {
  const game = new Game();
  void game;
  console.info('%cNeon Veil', 'color:#00f0ff;font-size:16px;font-weight:bold', '— Outlaw skies. Zero voice.');
} catch (err) {
  showBootError(err);
}
