// GENESIS — living inside the ForgeFlow site's frame (the parity audit's portal blockers B3, B4, B11):
//   * the site bar's Pause (and leaving fullscreen, which the bar turns into a pause) really pauses: the speed is
//     remembered, time stops and the game menu opens; the bar's Pause again, the menu's "Let time run" or closing the
//     menu (and any window opened from it) gives the speed back — unless the player took time over meanwhile;
//   * a hidden page stops time (the setting "Pause when hidden": on by default inside the site's frame, where a tab
//     switched away at 1000× would come back to centuries gone and a busy CPU) and gives it back on return;
//   * files the frame will not download (its sandbox has no allow-downloads: a photo, a save, a chronicle) are offered
//     in a new tab instead, with a toast that says why — a picture or a text to keep from there, and a saved world as a
//     page of text that Saves imports again (a sandboxed popup cannot download either, but the player can keep a page).
// Plain DOM; no host import (the shell wires it).

import type { ToastSpec } from './toasts.ts';
import { isEmbedded, setDownloadFallback } from './dom.ts';

export interface TimeGuardDeps {
  speed(): number;
  setSpeed(x: number): void;
  /** the game menu (the site's pause shows it) */
  openMenu(): void;
  /** close the menu and every window opened from it */
  closeWindows(): void;
  /** is the menu or another veiled window up */
  windowOpen(): boolean;
  /** is the title screen up (the world behind it is scenery: a pause there opens nothing) */
  titleOpen(): boolean;
  /** "Pause when hidden": 'auto' (on inside the site's frame), 'on', 'off' */
  hiddenPref(): string;
  toast(t: ToastSpec): void;
}

/** the site bar's pause, and the pause of a hidden page */
export class TimeGuard {
  private deps: TimeGuardDeps;
  /** time stopped by the site's Pause (or leaving fullscreen): the speed to give back */
  sitePaused = false;
  private siteSpeed = 1;
  /** time stopped because the page was hidden: the speed to give back on return */
  hiddenPaused = false;
  private hiddenSpeed = 1;
  private hiddenAt = 0;

  constructor(deps: TimeGuardDeps) {
    this.deps = deps;
    (window as unknown as { __PAUSE__?: { toggle(): void; pause(): void; resume(): void; paused(): boolean } }).__PAUSE__ = {
      toggle: () => { if (this.sitePaused) this.resume(); else this.pause(); },
      pause: () => this.pause(),
      resume: () => this.resume(),
      paused: () => this.sitePaused,
    };
    document.addEventListener('visibilitychange', () => this.visibility());
  }

  /** is "pause when hidden" on here */
  hiddenPauseOn(): boolean {
    const p = this.deps.hiddenPref();
    return p === 'on' || (p !== 'off' && isEmbedded());
  }

  /** the site's Pause: remember the speed, stop time, show the menu */
  pause(): void {
    const d = this.deps;
    if (!this.sitePaused) {
      this.sitePaused = true;
      // (a world already standing still stays still when the site lets go)
      this.siteSpeed = this.hiddenPaused ? this.hiddenSpeed : d.speed();
      this.hiddenPaused = false;
      if (d.speed() > 0) d.setSpeed(0);
    }
    if (!d.titleOpen() && !d.windowOpen()) d.openMenu();
  }

  /** the site's Pause again (or the menu let go): the speed back, the menu away */
  resume(): void {
    if (!this.sitePaused) return;
    this.sitePaused = false;
    const d = this.deps;
    if (d.windowOpen()) d.closeWindows();
    if (d.speed() === 0 && this.siteSpeed > 0) d.setSpeed(this.siteSpeed);
  }

  /** every frame: the site's pause lasts while the menu (or a window opened from it) is up */
  frame(): void {
    if (!this.sitePaused) return;
    const d = this.deps;
    // the player set time running themselves: the pause is theirs to keep or not
    if (d.speed() > 0) { this.sitePaused = false; return; }
    if (!d.windowOpen() && !d.titleOpen()) this.resume();
  }

  private visibility(): void {
    const d = this.deps;
    if (document.hidden) {
      if (!this.hiddenPauseOn() || this.sitePaused || d.speed() === 0) return;
      this.hiddenPaused = true;
      this.hiddenSpeed = d.speed();
      this.hiddenAt = performance.now();
      d.setSpeed(0);
      return;
    }
    if (!this.hiddenPaused) return;
    this.hiddenPaused = false;
    if (d.speed() === 0) {
      d.setSpeed(this.hiddenSpeed);
      if (performance.now() - this.hiddenAt > 4000) d.toast({ text: 'Time stood still while you were away; it runs again.', kind: 'info', ms: 4200 });
    }
  }
}

// ───────────────────────────── files the frame will not download ─────────────────────────────

const B64_HEAD = '-----BEGIN GENESIS SAVED WORLD-----';
const B64_TAIL = '-----END GENESIS SAVED WORLD-----';

/** the frame's blocked downloads: a toast that offers the file in a new tab (installed once by the shell) */
export function installDownloadFallback(toast: (t: ToastSpec) => void): void {
  setDownloadFallback((f) => {
    const kind = f.type.startsWith('image/') ? 'picture' : /^(text\/|application\/json)/.test(f.type) ? 'text' : 'file';
    const keep = kind === 'picture' ? 'save the picture from there' : kind === 'text' ? 'keep it from there (Ctrl+S)' : 'keep that page (Ctrl+S): Saves imports it back';
    toast({
      kind: 'info', title: 'Inside the site’s frame',
      text: `If ${f.name} did not download, the site’s frame blocked it. Open it in a new tab and ${keep}.`,
      ms: 16000,
      action: { label: 'Open in a new tab', title: 'Open the file in a new tab', run: () => { void openInTab(f).then((ok) => { if (!ok) toast({ kind: 'warn', text: 'The browser would not open a new tab either: allow pop-ups for this site, or play GENESIS on its own page to export.' }); }); } },
    });
  });
}

/**
 * The file in a new tab, written into it from here (a blank page opened by this frame is of its origin: a blob address
 * might not cross the site's partition, a document written into the tab always does). A picture shows itself; a text
 * shows as text; a saved world as a page of text Saves reads back (gzip + base64 between two marker lines).
 */
export async function openInTab(f: { name: string; blob: Blob; type: string }): Promise<boolean> {
  const w = window.open('', '_blank');
  if (!w) return false;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
  const style = 'body{margin:0;background:#07090f;color:#efe7d6;font:15px/1.5 Inter,system-ui,sans-serif}header{padding:14px 20px;border-bottom:1px solid #3a3426;color:#d9b878}main{padding:18px 20px}img{max-width:100%;height:auto;display:block;margin:0 auto;box-shadow:0 10px 40px #000}pre{white-space:pre-wrap;word-break:break-all;font:12px/1.4 ui-monospace,Consolas,monospace;color:#cfc6b4}';
  const page = (head: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(f.name)}</title><style>${style}</style></head><body><header>${head}</header><main>${body}</main></body></html>`;
  try {
    if (f.type.startsWith('image/')) {
      const url = await dataUrl(f.blob);
      write(w, page(`${esc(f.name)} — right-click the picture and choose “Save image as…”`, `<img alt="${esc(f.name)}" src="${url}">`));
    } else if (/^(text\/|application\/json)/.test(f.type)) {
      const text = await f.blob.text();
      write(w, page(`${esc(f.name)} — keep this page with Ctrl+S (⌘S), or copy the text`, `<pre>${esc(text)}</pre>`));
    } else {
      const text = await savedWorldText(f.name, f.blob);
      write(w, page(`${esc(f.name)} — keep this page with Ctrl+S (⌘S) as a file; in GENESIS, Saves → Import a file reads it back`, `<pre>${esc(text)}</pre>`));
    }
    return true;
  } catch (e) {
    try { write(w, page('The file could not be shown here', `<pre>${esc(e instanceof Error ? e.message : String(e))}</pre>`)); } catch { /* the tab is gone */ }
    return true;
  }
}

function write(w: Window, html: string): void {
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/** a blob as a data: address (in slices: a large save does not overflow the argument list) */
async function dataUrl(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${b.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

/** a saved world as text: a header, then its bytes (gzip when the browser can) in base64 between two marker lines */
export async function savedWorldText(name: string, blob: Blob): Promise<string> {
  let bytes = blob;
  let enc = 'base64';
  if (typeof CompressionStream !== 'undefined') {
    try { bytes = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob(); enc = 'gzip+base64'; } catch { bytes = blob; enc = 'base64'; }
  }
  const url = await dataUrl(bytes);
  const b64 = url.slice(url.indexOf(',') + 1);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 96) lines.push(b64.slice(i, i + 96));
  return `GENESIS saved world: ${name}\nencoding: ${enc}\nKeep this page as a file; in GENESIS open Saves and choose "Import a file" to return to this world.\n\n${B64_HEAD}\n${lines.join('\n')}\n${B64_TAIL}\n`;
}

/** a saved world kept as text (a page saved from the new tab: text or HTML) back to its bytes, or null if it is not one */
export async function savedWorldFromText(text: string): Promise<ArrayBuffer | null> {
  const a = text.indexOf(B64_HEAD), b = text.indexOf(B64_TAIL);
  if (a < 0 || b < a) return null;
  const gz = /encoding:\s*gzip\+base64/.test(text.slice(0, a));
  const b64 = text.slice(a + B64_HEAD.length, b).replace(/[^A-Za-z0-9+/=]/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (!gz) return bytes.buffer;
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack the saved world (no DecompressionStream).');
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
