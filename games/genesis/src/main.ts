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

/** the boot card: what is happening, how far along (a negative fraction keeps the bar), and a note when it runs long */
let barFrac = 0;
function bootProgress(msg: string, frac: number, note?: string): void {
  const fill = document.getElementById('boot-fill');
  const status = document.getElementById('boot-status');
  // (the bar only moves forward: stages report their own fractions)
  if (fill && frac >= 0) { barFrac = Math.max(barFrac, Math.min(1, frac)); fill.style.width = `${Math.round(Math.max(0.04, barFrac) * 100)}%`; }
  if (status && msg) status.textContent = msg;
  if (note) {
    const n = document.getElementById('boot-note'), t = document.getElementById('boot-note-text');
    if (t) t.textContent = note;
    if (n && !n.dataset.dismissed) n.hidden = false;
  }
}

/**
 * The boot failed before the world began: a friendly card (try again, or a lighter world) — not the fatal card, which
 * is for a world that broke while it ran. The reason is under "What happened".
 */
function showRetry(err: unknown): void {
  console.warn('[genesis] the world would not begin (the retry card says so) —', err);
  const card = document.getElementById('retry');
  const msg = document.getElementById('retry-msg');
  const words = document.getElementById('retry-words');
  if (msg) msg.textContent = errText(err);
  const text = errText(err);
  if (words && /worker|module|fetch|import|network|load/i.test(text)) words.textContent = 'The simulation could not be loaded: the connection may have dropped, or the game was updated while this page was open. Trying again usually works.';
  else if (words && /memory|allocation|out of/i.test(text)) words.textContent = 'This machine ran out of memory while making the world. A lighter world (the barren one) needs far less.';
  const light = document.getElementById('retry-light');
  if (light) light.onclick = () => { const p = new URLSearchParams(location.search); p.set('scenario', 'barren'); p.delete('load'); location.search = p.toString(); };
  if (card) card.hidden = false;
  document.getElementById('boot')?.classList.add('gone');
}

/**
 * On a phone or a tablet (the site bar's device signal: html.ffg-touch, or a coarse pointer and no fine one) the game
 * says it is best on a desktop before it spends a heavy boot there; "Play anyway" goes on (once per visit).
 */
function touchGate(): Promise<void> {
  const html = document.documentElement;
  const dev = (window as unknown as { FFG_DEVICE?: { touch?: boolean; mobile?: boolean } }).FFG_DEVICE;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  const touch = html.classList.contains('ffg-touch') || !!dev?.mobile || coarse;
  let ok = false;
  try { ok = sessionStorage.getItem('genesis.touch.ok') === '1'; } catch { /* ask */ }
  if (!touch || ok || new URLSearchParams(location.search).get('touch') === '1') return Promise.resolve();
  const card = document.getElementById('touchcard');
  const go = document.getElementById('touch-go');
  if (!card || !go) return Promise.resolve();
  card.hidden = false;
  return new Promise((done) => {
    go.addEventListener('click', () => {
      try { sessionStorage.setItem('genesis.touch.ok', '1'); } catch { /* asked again next time */ }
      card.hidden = true;
      done();
    }, { once: true });
  });
}

async function main(): Promise<void> {
  let booted = false;
  window.addEventListener('error', (e) => { if (!booted) showRetry(e.error ?? e.message); });
  window.addEventListener('unhandledrejection', (e) => { if (!booted) showRetry(e.reason); });
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
  document.getElementById('boot-wait')?.addEventListener('click', () => { const n = document.getElementById('boot-note'); if (n) { n.hidden = true; n.dataset.dismissed = '1'; } });
  await touchGate();
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
    // (a world that would not begin gets the friendly card; one that broke after it began, the fatal one)
    if (booted) showFatal('the world failed to begin', e); else showRetry(e);
    readyFail(e);
  }
}

main().catch((e) => showFatal('the world failed to begin', e));
