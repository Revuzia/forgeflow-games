// PERF F20 — textures flagged needsUpdate are uploaded before the frame's first pass (renderer.initTexture), once;
// disposed ones are dropped; images still loading and render-target textures are left to three.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataTexture, Texture } from 'three';
import { flushTextureUploads, installTexturePreUpload } from '../src/render/upload.ts';

test('pre-upload: flagged textures go up once at the flush; disposed / loading ones do not', () => {
  installTexturePreUpload();
  const up: Texture[] = [];
  const r = { initTexture: (t: Texture) => { up.push(t); } } as never;
  const a = new DataTexture(new Uint8Array(16), 2, 2);
  const b = new DataTexture(new Uint8Array(16), 2, 2);
  const c = new DataTexture(new Uint8Array(16), 2, 2);
  const loading = new Texture({ complete: false } as never);
  const v0 = a.version;
  a.needsUpdate = true; a.needsUpdate = true;
  assert.equal(a.version, v0 + 2, 'the setter still bumps the version');
  b.needsUpdate = true;
  c.needsUpdate = true; c.dispose();
  loading.needsUpdate = true;
  assert.equal(flushTextureUploads(r), 2);
  assert.deepEqual(up, [a, b]);
  assert.equal(flushTextureUploads(r), 0, 'nothing left');
  b.needsUpdate = true;
  assert.equal(flushTextureUploads(r), 1);
});
