// BLOCKTOOTH — entry point (CONTRACT.md §14). app lane.
//
// Checks for WebGL 2 (→ #nogpu card), builds the App, installs window.__BT__ / __PAUSE__, boots
// (title, or ?autostart straight into a run) and reports anything fatal in #fatal. The inline
// guard in index.html covers the moments before this module runs; we take over from it here.

import { App, parseParams } from './game.ts';
import { installTestSurface } from './testsurface.ts';

declare global {
  interface Window {
    /** set as soon as this module runs (index.html's boot guard checks it) */
    __BT_MAIN__?: boolean;
    /** index.html's pre-module error guard */
    __BT_BOOT__?: { handoff(): void; fail(title: string, detail: unknown): void };
  }
}

window.__BT_MAIN__ = true;

/** Readable text for any thrown value (stack when there is one). */
function errText(err: unknown): string {
  if (err instanceof Error) {
    const head = `${err.name}: ${err.message}`;
    const stack = err.stack ?? '';
    return (stack.includes(err.message) ? stack : `${head}\n${stack}`).trim();
  }
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err, null, 2) ?? String(err); } catch { return String(err); }
}

let fatalShown = false;

/** Show the TECHNICAL DIFFICULTIES card (first fatal wins; later ones only log). */
export function showFatal(title: string, err: unknown): void {
  console.error('[blocktooth] FATAL —', title, err);
  if (fatalShown) return;
  fatalShown = true;
  const card = document.getElementById('fatal');
  const sub = document.getElementById('fatal-sub');
  const msg = document.getElementById('fatal-msg');
  if (sub) sub.textContent = title;
  if (msg) msg.textContent = errText(err);
  if (card) card.hidden = false;
  document.getElementById('boot')?.classList.add('gone');
}

/** Can this browser actually create a WebGL 2 context (not just define the class)? */
function hasWebGL2(): boolean {
  try {
    if (typeof WebGL2RenderingContext === 'undefined') return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();          // free the probe context right away
    return true;
  } catch {
    return false;
  }
}

function ensureEl<K extends keyof HTMLElementTagNameMap>(id: string, tag: K): HTMLElementTagNameMap[K] {
  const found = document.getElementById(id);
  if (found && found.tagName.toLowerCase() === tag) return found as HTMLElementTagNameMap[K];
  const e = document.createElement(tag);
  e.id = id;
  document.body.appendChild(e);
  return e;
}

async function main(): Promise<void> {
  let booted = false;
  // errors that escape the app during boot are fatal; afterwards they are logged (the app itself
  // escalates sim failures and persistent frame failures through onFatal)
  window.addEventListener('error', (e) => {
    if (!booted) showFatal('the broadcast failed to start', e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (!booted) showFatal('the broadcast failed to start', e.reason);
    else console.error('[blocktooth] unhandled rejection', e.reason);
  });
  window.__BT_BOOT__?.handoff();

  if (!hasWebGL2()) {
    document.getElementById('boot')?.classList.add('gone');
    const card = document.getElementById('nogpu');
    if (card) card.hidden = false;
    else showFatal('WebGL 2 is not available', new Error('This browser cannot create a WebGL 2 context. Enable hardware acceleration or try another browser.'));
    return;
  }

  const canvas = ensureEl('game', 'canvas');
  const ui = ensureEl('ui', 'div');
  const params = parseParams(location.search);

  let app: App;
  try {
    app = new App(canvas, ui, params);
  } catch (e) {
    showFatal('the broadcast failed to start', e);
    return;
  }
  app.onFatal = showFatal;
  installTestSurface(app);

  try {
    await app.boot();
  } catch (e) {
    showFatal('the broadcast failed to start', e);
    return;
  }
  booted = true;
}

void main();
