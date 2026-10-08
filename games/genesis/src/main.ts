// GENESIS — entry point (CONTRACT.md §3): checks for WebGL 2 (→ #nogpu card), builds the App, installs
// window.__GENESIS__, drives the boot card, and reports anything fatal in #fatal. index.html's inline guard covers the
// moments before this module runs; main takes over from it here. Errors never blank the screen (§20).

import { App, parseParams } from './app.ts';
import { installTestSurface } from './testsurface.ts';

declare global {
  interface Window {
    __GN_MAIN__?: boolean;
    __GN_BOOT__?: { handoff(): void; fail(title: string, detail: unknown): void };
  }
}

window.__GN_MAIN__ = true;

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
export function showFatal(title: string, err: unknown): void {
  console.error('[genesis] FATAL —', title, err);
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

function hasWebGL2(): boolean {
  try {
    if (typeof WebGL2RenderingContext === 'undefined') return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function bootProgress(msg: string, frac: number): void {
  const fill = document.getElementById('boot-fill');
  const status = document.getElementById('boot-status');
  if (fill) fill.style.width = `${Math.round(Math.max(0.04, Math.min(1, frac)) * 100)}%`;
  if (status && msg) status.textContent = msg;
}

async function main(): Promise<void> {
  let booted = false;
  window.addEventListener('error', (e) => { if (!booted) showFatal('the world failed to begin', e.error ?? e.message); });
  window.addEventListener('unhandledrejection', (e) => { if (!booted) showFatal('the world failed to begin', e.reason); });
  window.__GN_BOOT__?.handoff();

  let app: App | null = null;
  let readyOk!: () => void;
  let readyFail!: (e: unknown) => void;
  const ready = new Promise<void>((ok, fail) => { readyOk = ok; readyFail = fail; });
  ready.catch(() => { /* reported through the fatal card */ });
  installTestSurface(() => app, ready);

  if (!hasWebGL2()) {
    const card = document.getElementById('nogpu');
    if (card) card.hidden = false;
    document.getElementById('boot')?.classList.add('gone');
    readyFail(new Error('WebGL 2 is not available'));
    return;
  }

  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('index.html has no #game canvas');
  const opts = parseParams(location.search);
  try {
    app = new App(canvas, opts);
    // dev tooling handle (renderer internals for probes); only with ?dev=1
    if (opts.dev) (window as unknown as { __GENESIS_APP__?: App }).__GENESIS_APP__ = app;
    app.onFatal = (title, err) => showFatal(title, err);
    await app.start(bootProgress);
    booted = true;
    document.getElementById('boot')?.classList.add('gone');
    await app.waitFrames(2);
    readyOk();
  } catch (e) {
    showFatal('the world failed to begin', e);
    readyFail(e);
  }
}

main().catch((e) => showFatal('the world failed to begin', e));
