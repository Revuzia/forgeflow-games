// PERF s18: when the page goes, the render workers end and the WebGL context is lost on purpose (the reload leak).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_RELEASE_STATE, installPageRelease, onPageRelease, pageReleaseReset, registerPageWorker, releasePage } from '../src/render/pagerelease.ts';

function fakes() {
  const listeners = new Map<string, ((e: { persisted?: boolean }) => void)[]>();
  const win = { addEventListener: (t: string, fn: (e: { persisted?: boolean }) => void) => { listeners.set(t, [...(listeners.get(t) ?? []), fn]); } };
  const fire = (t: string, e: { persisted?: boolean } = {}) => { for (const f of listeners.get(t) ?? []) f(e); };
  let lost = 0;
  const gl = { isContextLost: () => lost > 0, getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext: () => { lost++; } } : null) };
  const canvas = { width: 1686, height: 963 };
  return { win, fire, gl, canvas, lost: () => lost, listeners };
}

test('pagerelease: pagehide ends the workers, loses the context once, shrinks the canvas, runs the hooks', () => {
  pageReleaseReset();
  const f = fakes();
  let ended = 0, hooked = 0, reloads = 0;
  registerPageWorker({ terminate: () => { ended++; } });
  registerPageWorker({ terminate: () => { ended++; } });
  registerPageWorker({ terminate: () => { throw new Error('gone'); } });
  assert.equal(installPageRelease(f.win, f.gl, f.canvas, () => { reloads++; }, true), true);
  onPageRelease(() => { hooked++; });
  onPageRelease(() => { throw new Error('a hook that fails must not stop the rest'); });
  onPageRelease(() => { hooked++; });
  assert.equal(f.lost(), 0);
  f.fire('pagehide', { persisted: false });
  assert.equal(ended, 2);
  assert.equal(f.lost(), 1);
  assert.deepEqual([f.canvas.width, f.canvas.height], [1, 1]);
  assert.equal(hooked, 2);
  assert.equal(PAGE_RELEASE_STATE.released, true);
  assert.equal(PAGE_RELEASE_STATE.lostContext, true);
  // visibilitychange + pagehide both fire on the way out on some browsers: once only
  f.fire('pagehide', { persisted: false });
  assert.equal(f.lost(), 1);
  assert.equal(ended, 2);
  assert.equal(hooked, 2);
  assert.equal(reloads, 0);
});

test('pagerelease: a page restored from the back/forward cache has no context: it reloads; a first show does not', () => {
  pageReleaseReset();
  const f = fakes();
  let reloads = 0;
  installPageRelease(f.win, f.gl, f.canvas, () => { reloads++; }, true);
  f.fire('pageshow', { persisted: false });
  f.fire('pageshow', { persisted: true }); // (never hidden by us: nothing was released)
  assert.equal(reloads, 0);
  f.fire('pagehide', { persisted: true });
  assert.equal(f.lost(), 1);
  f.fire('pageshow', { persisted: true });
  assert.equal(reloads, 1);
});

test('pagerelease: switched off, or without a window, nothing is installed; installing twice is once', () => {
  pageReleaseReset();
  const f = fakes();
  assert.equal(installPageRelease(f.win, f.gl, f.canvas, () => {}, false), false);
  assert.equal(installPageRelease(null, f.gl, f.canvas, () => {}, true), false);
  assert.equal(f.listeners.size, 0);
  assert.equal(installPageRelease(f.win, f.gl, f.canvas, () => {}, true), true);
  assert.equal(installPageRelease(f.win, f.gl, f.canvas, () => {}, true), false);
  assert.equal(f.listeners.get('pagehide')?.length, 1);
});

test('pagerelease: an already lost context, or one without the extension, is left alone', () => {
  pageReleaseReset();
  let calls = 0;
  releasePage({ isContextLost: () => true, getExtension: () => { calls++; return null; } }, null);
  assert.equal(calls, 0);
  pageReleaseReset();
  releasePage({ getExtension: () => null }, { width: 5, height: 5 });
  assert.equal(PAGE_RELEASE_STATE.lostContext, false);
  assert.equal(PAGE_RELEASE_STATE.released, true);
});
